/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * Companion RESTlet for tools/deploy.js: replaces the content of an existing File Cabinet file and
 * returns the SHA-256 of what was stored. Not deployed in this engagement; provided for the future.
 */
define(['N/file', 'N/encode', 'N/crypto'], function (file, encode, crypto) {
  function post(body) {
    var f = file.load({ id: Number(body.fileId) });
    var text = encode.convert({ string: body.contentBase64, inputEncoding: encode.Encoding.BASE_64, outputEncoding: encode.Encoding.UTF_8 });
    var nf = file.create({ name: f.name, fileType: f.fileType, contents: text, folder: f.folder, isOnline: f.isOnline, description: f.description });
    var id = nf.save();
    var stored = file.load({ id: id }).getContents();
    var h = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 }); h.update({ input: stored, inputEncoding: encode.Encoding.UTF_8 });
    return { fileId: id, sha256: h.digest({ outputEncoding: encode.Encoding.HEX }).toLowerCase() };
  }
  return { post: post };
});
