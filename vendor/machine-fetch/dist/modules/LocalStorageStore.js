import { localStorageStore } from '../stores/local-storage.js';
/** Creates an operation store in browser storage. Site-data clearing erases its records. */
export const create = localStorageStore;
