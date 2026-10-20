import { fileStore } from '../stores/file.js';
/** Creates an operation store in `directory`, which must not be shared with other data. */
export const create = fileStore;
