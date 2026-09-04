"""Conservative DART XML extraction. Never evaluate source markup or invent facts."""
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path, PurePosixPath
from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'research/documents-config.json').read_text(encoding='utf-8'))


class DocumentError(Exception):
    pass


def digest(data: bytes):
    return hashlib.sha256(data).hexdigest()


def tag(node):
    return etree.QName(node).localname.upper() if isinstance(node.tag, str) else ''


def text(node):
    # Preserve all source characters/numbers. Whitespace is normalized, not units or periods.
    def pieces(item):
        if tag(item) in {'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'}:
            return ''
        if tag(item) == 'BR':
            return '\n'
        value = item.text or ''
        for child in item:
            value += pieces(child) + (child.tail or '')
        return value + ('\n' if tag(item) == 'P' else '')
    return re.sub(r'\s+', ' ', pieces(node)).strip()


def parse_archive(data: bytes, receipt: str):
    if len(data) > CONFIG['max_archive_bytes']:
        raise DocumentError('원문 압축 파일 크기 한도 초과')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        # Provider errors are often XML with HTTP 200. Do not expose raw provider messages.
        code = re.search(rb'<status>\s*(\d{3})\s*</status>', data[:4096])
        codes = {'010': 'DART 인증키 확인 필요', '011': 'DART 인증키 사용 중지', '012': 'DART 접근 IP 확인 필요',
                 '013': '조회된 원문 없음', '014': 'DART 원문 파일 없음', '020': 'DART 요청 한도 초과', '800': 'DART 점검 중'}
        raise DocumentError(codes.get(code[1].decode() if code else '', 'DART 원문 ZIP 형식이 아닙니다.')) from None
    with archive:
        members = archive.infolist()
        if len(members) > CONFIG['max_members'] or sum(m.file_size for m in members) > CONFIG['max_unpacked_bytes']:
            raise DocumentError('압축 해제 크기 또는 파일 개수 한도 초과')
        names = [m.filename for m in members]
        if len(names) != len(set(names)):
            raise DocumentError('중복된 원문 파일명')
        for member in members:
            p = PurePosixPath(member.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in member.filename or ':' in member.filename or member.flag_bits & 1:
                raise DocumentError('지원하지 않는 원문 압축 경로 또는 암호화 파일')
        xmls = [m for m in members if m.filename.lower().endswith('.xml')]
        selected = next((m for m in xmls if PurePosixPath(m.filename).name == receipt + '.xml'), None)
        if selected is None and len(xmls) == 1:
            selected = xmls[0]
        if selected is None:
            raise DocumentError('주 문서 XML을 식별하지 못했습니다. DART 원문에서 확인해 주세요.')
        raw = archive.read(selected)
    if re.search(rb'<!ENTITY\b|<!DOCTYPE[^>]*\[', raw, re.I):
        raise DocumentError('외부 엔터티 또는 내부 DTD 선언은 처리하지 않습니다.')
    normalized_ampersands = normalized_labels = 0
    try:
        tree = etree.fromstring(raw, etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, recover=False, huge_tree=False))
    except etree.XMLSyntaxError:
        # Some real DART XML contains literal R&D. Only escape bare ampersands;
        # never use recover=True, fetch a DTD, rewrite numbers, or repair nesting.
        parts = re.split(rb'(<!\[CDATA\[.*?\]\]>|<!--.*?-->)', raw, flags=re.S)
        for i in range(0,len(parts),2):
            parts[i], count = re.subn(rb'&(?![A-Za-z_:][A-Za-z0-9_.:-]*;|#\d+;|#x[0-9A-Fa-f]+;)', b'&amp;', parts[i])
            normalized_ampersands += count
            # DART uses ASCII XML tags; malformed angle-bracket Korean captions
            # such as <이사ㆍ감사 전체의 보수현황> are literal display text.
            parts[i], count = re.subn(rb'<([\x80-\xff][^<>]*)>', rb'&lt;\1&gt;', parts[i])
            normalized_labels += count
        try:
            tree = etree.fromstring(b''.join(parts), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, recover=False, huge_tree=False))
        except etree.XMLSyntaxError:
            raise DocumentError('XML 구조를 안전하게 해석하지 못했습니다. 내용을 임의 복구하지 않았습니다.') from None
    if tag(tree) != 'DOCUMENT':
        raise DocumentError('지원하지 않는 XML 문서 형식입니다.')
    if sum(1 for _ in tree.iter()) > CONFIG['max_nodes']:
        raise DocumentError('원문 구조 크기 한도 초과')

    warnings = ['문단·표 추출본입니다. 서식·페이지 위치는 원문과 다를 수 있습니다. 숫자·단위는 계산하거나 환산하지 않았습니다.',
                '이미지·PDF·외부 첨부·XBRL 연결 파일은 해석하지 않습니다. 주 문서만으로 모든 공시 내용을 확인했다고 볼 수 없습니다.']
    if normalized_ampersands:
        warnings.append(f'원문 XML의 비이스케이프 & 문자 {normalized_ampersands}곳을 표시용으로 처리했습니다. 원본 ZIP은 변경하지 않았습니다.')
    if normalized_labels:
        warnings.append(f'원문의 꺾쇠 한글 표제 {normalized_labels}곳을 텍스트로 표시했습니다. 원본 ZIP은 변경하지 않았습니다.')
    sections = []
    blocks = []
    section = None

    def add(kind, node, **fields):
        nonlocal section
        if section is None:
            section = {'id': 's0000', 'title': '표지·문서 정보', 'group': 'other', 'block_count': 0}
            sections.append(section)
        if len(blocks) >= CONFIG['max_blocks']:
            raise DocumentError('문단·표 개수 한도 초과')
        blocks.append({'id': f'b{len(blocks):05d}', 'section_id': section['id'], 'kind': kind,
                       'source_path': tree.getroottree().getpath(node), **fields})
        section['block_count'] += 1

    def walk(node):
        nonlocal section
        name = tag(node)
        if not name:
            return
        if name in {'FORMULA-VERSION', 'SUMMARY'}:
            return  # machine-only DART form metadata, not report paragraphs
        if name in {'SCRIPT', 'STYLE', 'IMG', 'IMAGE', 'IFRAME', 'OBJECT'}:
            if '지원하지 않는 삽입 요소가 있어 DART 원문 확인이 필요합니다.' not in warnings:
                warnings.append('지원하지 않는 삽입 요소가 있어 DART 원문 확인이 필요합니다.')
            return
        if name == 'TITLE' and text(node):
            title = text(node)
            scope = [title] + [text(child) for ancestor in node.iterancestors() if tag(ancestor).startswith('SECTION') for child in ancestor if tag(child) == 'TITLE']
            group = 'notes' if any('주석' in h for h in scope) else 'business' if any('사업의 내용' in h for h in scope) else 'financials' if any('재무' in h for h in scope) else 'other'
            section = {'id': f's{len(sections):04d}', 'title': title, 'group': group, 'block_count': 0}
            sections.append(section)
            add('text', node, text=title)
            return
        if name == 'TABLE':
            rows = []
            nested = any(tag(c) == 'TABLE' for c in node.iterdescendants())
            if nested:
                warnings.append('중첩 표는 텍스트로 표시한 부분이 있습니다. DART 원문에서 열·병합 구조를 확인해 주세요.')
                add('text', node, text=text(node))
                return
            for row in node.iter():
                if tag(row) != 'TR':
                    continue
                cells = []
                for cell in row:
                    if tag(cell) not in {'TD', 'TH', 'TE', 'TU'}:
                        continue
                    def span(key):
                        value = cell.get(key, cell.get(key.lower(), '1'))
                        if not str(value).isdigit() or not 1 <= int(value) <= CONFIG['max_table_span']:
                            raise DocumentError('지원하지 않는 표 병합 크기')
                        return int(value)
                    cells.append({'text': text(cell), 'header': tag(cell) == 'TH', 'rowspan': span('ROWSPAN'), 'colspan': span('COLSPAN')})
                if cells:
                    rows.append(cells)
            if rows:
                add('table', node, rows=rows, text='\n'.join(' | '.join(c['text'] for c in row) for row in rows))
            elif text(node):
                add('text', node, text=text(node))
            return
        if name in {'P', 'DOCUMENT-NAME', 'COMPANY-NAME', 'SPAN', 'SUBTITLE', 'LIBRARY', 'TU', 'TE'}:
            if any(tag(c) in {'TABLE', 'TITLE', 'P'} for c in node.iterdescendants()):
                # Walk containers instead of flattening embedded tables.
                if (node.text or '').strip():
                    add('text', node, text=node.text.strip())
                for child in node:
                    walk(child)
                    if (child.tail or '').strip():
                        add('text', child, text=child.tail.strip())
            elif text(node):
                add('text', node, text=text(node))
            return
        if (node.text or '').strip():
            add('text', node, text=node.text.strip())
        for child in node:
            walk(child)
            if (child.tail or '').strip():
                add('text', child, text=child.tail.strip())

    walk(tree)
    if not blocks:
        raise DocumentError('표시 가능한 문단·표가 없습니다.')
    omitted = [name for name in names if name != selected.filename and not name.endswith('/')]
    result = {'parser_version': CONFIG['parser_version'], 'receipt': receipt, 'member': selected.filename,
              'xml_sha256': digest(raw), 'omitted_members': omitted, 'sections': sections, 'blocks': blocks,
              'normalization': {'bare_ampersands': normalized_ampersands, 'literal_captions': normalized_labels},
              'warnings': list(dict.fromkeys(warnings)), 'status': 'partial' if omitted or len(warnings) > 2 else 'ready'}
    if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > CONFIG['max_extracted_bytes']:
        raise DocumentError('추출 결과 크기 한도 초과')
    return result
