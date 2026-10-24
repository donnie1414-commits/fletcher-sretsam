/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * CSP experiment (§4): does a File Cabinet .js file load from a Suitelet-rendered page?
 * Deploy this Suitelet, upload al_csp_probe.js to the File Cabinet, set the script parameter
 * custscript_al_csp_probe_file to its internal id, open the Suitelet. The page reports the result.
 */
define(['N/file', 'N/runtime'], function (file, runtime) {
  function onRequest(context) {
    var id = runtime.getCurrentScript().getParameter({ name: 'custscript_al_csp_probe_file' });
    var url = null, err = null;
    try { url = file.load({ id: Number(id) }).url; } catch (e) { err = e.message; }
    context.response.write('<!doctype html><html><body><h3>Amicus CSP probe</h3><p id="r">waiting for external script…</p>' +
      '<p>file id: ' + id + ' · url: ' + (url || '(none: ' + err + ')') + '</p>' +
      (url ? '<script src="' + url + '"></script>' : '') +
      '<script>setTimeout(function(){var r=document.getElementById("r"); if(!window.__AL_CSP_OK) r.textContent="FAILED: external script did not execute (blocked by CSP or wrong url). Fallback: inline the bundle via the shell route — see docs/STATUS.md."; },3000);</script></body></html>');
  }
  return { onRequest: onRequest };
});
