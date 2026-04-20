import {defineCollection} from 'astro:content';
import {docsLoader} from '@astrojs/starlight/loaders';
import {docsSchema} from '@astrojs/starlight/schema';
import {z} from 'astro:content';

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        sourcePath: z.string().optional(),
        sourceUrl: z.string().optional(),
      }),
    }),
  }),
};
