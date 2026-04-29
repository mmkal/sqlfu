import type {
  CreateSqlfuUiPartialFetchInput as BaseCreateSqlfuUiPartialFetchInput,
  SqlfuUiAsset,
  SqlfuUiAssetBody,
  SqlfuUiAssets,
  SqlfuUiPartialFetch,
} from 'sqlfu/ui/browser';
import bundledSqlfuUiAssets from '#serialized-assets';
import packageJson from '../../package.json' with {type: 'json'};

export const version: string = packageJson.version;
export const assets: Record<string, string> = bundledSqlfuUiAssets;

export type CreateSqlfuUiPartialFetchInput = Omit<BaseCreateSqlfuUiPartialFetchInput, 'assets'> & {
  assets?: SqlfuUiAssets;
};

export type {SqlfuUiAsset, SqlfuUiAssetBody, SqlfuUiAssets, SqlfuUiPartialFetch};

export function createSqlfuUiPartialFetch(input: CreateSqlfuUiPartialFetchInput): SqlfuUiPartialFetch {
  let partialFetch: SqlfuUiPartialFetch | undefined;
  let partialFetchPromise: Promise<SqlfuUiPartialFetch> | undefined;

  return async (request) => {
    partialFetchPromise ||= import('sqlfu/ui/browser').then(({createSqlfuUiPartialFetch}) =>
      createSqlfuUiPartialFetch({
        ...input,
        assets: input.assets || assets,
      }),
    );
    partialFetch ||= await partialFetchPromise;
    return partialFetch(request);
  };
}
