import {ComparisonWorkspace} from '@/components/comparison-workspace';
import {comparisonSnapshot} from '@/lib/server/comparison-store';
export const dynamic='force-dynamic';
export const metadata={title:'기업 비교 — Value Dashboard'};
export default function ComparePage(){return <ComparisonWorkspace items={comparisonSnapshot().items}/>;}
