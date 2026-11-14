// Structural checks for uploaded pictures: the type must match the real file contents, start to end.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function validImage(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 100) return false;
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  if (mime === 'image/png') return buf.subarray(0, 8).equals(PNG_SIG) && buf.subarray(buf.length - 12).equals(PNG_END) && buf.toString('ascii', 12, 16) === 'IHDR';
  if (mime === 'image/webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.readUInt32LE(4) + 8 === buf.length;
  return false;
}
module.exports = { validImage };
