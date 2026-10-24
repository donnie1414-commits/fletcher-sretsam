/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Amicus Leasing Workspace — entry. Routing only (§4). Built by tools/build.js into dist/amicus_leasing_sl.js.
 */
import query from 'N/query';
import record from 'N/record';
import runtime from 'N/runtime';
import log from 'N/log';
import file from 'N/file';
import cache from 'N/cache';
import { createApp } from './app.js';

let app = null;
export function onRequest(context) {
  if (!app) app = createApp({ query, record, runtime, log, file, cache });
  app.handle(context);
}
