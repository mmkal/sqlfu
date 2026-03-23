import type { Client, Transaction } from '@libsql/client';
export type ListPostSummariesResult = {
    id?: any;
    slug?: any;
    title?: any;
    published_at?: any;
    excerpt?: any;
};
export declare function listPostSummaries(client: Client | Transaction): Promise<ListPostSummariesResult[]>;
//# sourceMappingURL=list-post-summaries.d.ts.map