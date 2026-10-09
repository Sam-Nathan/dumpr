// Pure domain logic shared by mobile, web and (via relative import) edge functions.
// No runtime dependencies and no Node / React Native specific imports in this package.
export const DUMPR_CORE_VERSION = '0.1.0';

// Upload pipeline: state machine, backoff, part planning, wire types, validation, shared runner.
export * from './upload/index.ts';
// BlurHash placeholders.
export {
  encode as encodeBlurhash,
  decode as decodeBlurhash,
  validateBlurhash,
  isBlurhashValid,
  blurhashAverageColor,
  BlurhashError,
} from './blurhash/index.ts';
