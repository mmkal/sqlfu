import * as fs from 'fs'
import * as path from 'path';
import {type StandardSchemaV1} from './standard-schema/contract.js';
import { looksLikeStandardSchemaFailure } from './standard-schema/utils.js';
import { prettifyStandardSchemaError } from './standard-schema/errors.js';

type DescribeLike = (name: string, run: () => void) => void;
type TestLike = (name: string, run: () => void | Promise<void>) => void;
type ExpectLike = (value: string) => {toBe: (expected: string) => void};

export const createParser = <Input>(params: {
  commentPrefix: string;
  input: StandardSchemaV1<Input>;
  getOutput: (args: {
    input: Input;
    filepath: string;
    test: string;
    header: string;
    /** JSON parsed from a "default input: ..." comment in the header. */
    defaultInput: unknown;
  }) => string | Promise<string>;
}) => {
  const registerTests = (registerParams: {
    argv?: string[];
    glob: string;
    cwd: string;
    describe: DescribeLike;
    test: TestLike;
    expect: ExpectLike;
  }) => {
    const argv = registerParams.argv;
    const update = argv?.includes('--update') || argv?.includes('-u');
    let updated = false;
    const files = fs.globSync(registerParams.glob, {cwd: registerParams.cwd});
    for (const file of files) {
      registerParams.describe(path.relative(registerParams.cwd, file), () => {
        let parsed = parseFixtureContents(file, params);
        for (const testCase of parsed) {
          registerParams.test(testCase.name, async () => {
            if (updated) {
              // re-parse the file
              parsed = parseFixtureContents(file, params);
            }
            const parsedInput = await params.input['~standard'].validate(testCase.input);
            if (looksLikeStandardSchemaFailure(parsedInput)) {
              throw new Error(`${file}:${testCase.name}: input is invalid:\n${prettifyStandardSchemaError(parsedInput)}`);
            }
            const actualOutput = await params.getOutput({
              filepath: file,
              test: testCase.name,
              input: parsedInput.value,
              header: testCase.header,
              defaultInput: testCase.defaultInput,
            });
            if (actualOutput === testCase.output) return;
            if (update) {
              testCase.writeOutput(actualOutput);
              updated = true;
              return;
            }
            registerParams.expect(actualOutput).toBe(testCase.output);
          });
        }
      });
    }
  }

  return {registerTests};
};

function parseFixtureContents(filepath: string, params: {commentPrefix: string}) {
  const content = fs.readFileSync(filepath, 'utf8');
  const startRegion = `${params.commentPrefix} #region:`;
  const endRegion = `${params.commentPrefix} #endregion`;
  const [header, ...regions] = content.split(startRegion)
  const tests = regions
    .map(region => ({
      startIndex: -1,
      endIndex: -1,
      name: region.split('\n')[0].trim(),
      body: region.split(endRegion)[0],
    }));

  const names = tests.map(test => test.name);
  if (names.length !== new Set(names).size) {
    throw new Error(`Duplicate test names in ${filepath}`);
  }

  return tests.map(({name, body}) => {
    const lines = body.split('\n');
    const annotatedLines = lines.map((line, index) => {
      const isComment = line.startsWith(params.commentPrefix);
      const comment = isComment ? line.slice(params.commentPrefix.length).trim() : null;
      const isPropComment = /^\w+:/.test(comment || '');
      const propKey = isPropComment ? comment!.split(':')[0].trim() : null;
      const isInlinePropComment = /^\w+:\s?\S+$/.test(comment || '');
      const inlinePropValue = isInlinePropComment ? jsonParse(comment!.slice(comment!.indexOf(':') + 1).trim()) : null;
      return {propKey, value: inlinePropValue, line, index, isComment, comment, isPropComment, isInlinePropComment, inlinePropValue};
    })
    annotatedLines.forEach(line => {
      if (line.isPropComment && !line.isInlinePropComment) {
        // ok it's a prop comment but not inline, read down to the next prop comment and use the values in between as a string
        const nextPropComment = annotatedLines.find(l => l.isPropComment && l.index > line.index);
        line.value = annotatedLines
          .slice(line.index + 1, nextPropComment?.index ?? annotatedLines.length)
          .map(l => l.line)
          .join('\n');
      }
    })
    
    const {output, ...input} = Object.fromEntries(annotatedLines.flatMap(line => {
      return line.isPropComment ? [[line.propKey, line.value]] : [];
    }))

    const writeOutput = (output: string) => {
      const freshContent = fs.readFileSync(filepath, 'utf8');
      const regionStart = `${startRegion}${body.split('\n')[0]}`;
      const regionStartIndex = freshContent.indexOf(regionStart);
      const regionEndIndex = freshContent.indexOf(endRegion, regionStartIndex);
      const regionBody = freshContent.slice(regionStartIndex + regionStart.length, regionEndIndex);
      let newRegionBody = regionBody.split(`${params.commentPrefix} output:`)[0];
      newRegionBody += `${params.commentPrefix} output:\n${output}`;
      const newContent = freshContent.slice(0, regionStartIndex + regionStart.length) + newRegionBody + '\n' + freshContent.slice(regionEndIndex);
      fs.writeFileSync(filepath, newContent);
    }

    const defaultInputLine = header.split('\n').find(line => line.startsWith(`${params.commentPrefix} default input:`));
    const defaultInput = maybeJsonParse(defaultInputLine?.slice(params.commentPrefix.length).trim() ?? '{}');

    return {header, name, input, output, writeOutput, defaultInput};
  })
}

const maybeJsonParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

const jsonParse = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON: ${value}`);
  }
}