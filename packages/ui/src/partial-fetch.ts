import type {
  CreateSqlfuUiPartialFetchInput as BaseCreateSqlfuUiPartialFetchInput,
  SqlfuUiAsset,
  SqlfuUiAssetBody,
  SqlfuUiAssets,
  SqlfuUiPartialFetch,
} from 'sqlfu/ui/browser';

export type CreateSqlfuUiPartialFetchInput = Omit<BaseCreateSqlfuUiPartialFetchInput, 'assets'> & {
  assets?: SqlfuUiAssets;
};

export type {SqlfuUiAsset, SqlfuUiAssetBody, SqlfuUiAssets, SqlfuUiPartialFetch};

export declare const sqlfuUiAssets: SqlfuUiAssets;

export declare function createSqlfuUiPartialFetch(input: CreateSqlfuUiPartialFetchInput): SqlfuUiPartialFetch;
