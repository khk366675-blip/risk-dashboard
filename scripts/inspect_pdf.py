import json
import sys
from pypdf import PdfReader
reader=PdfReader(sys.argv[1],strict=True)
if reader.is_encrypted: raise ValueError('암호화된 PDF는 지원하지 않습니다')
print(json.dumps({'pages':len(reader.pages)}))
