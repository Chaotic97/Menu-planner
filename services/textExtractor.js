/**
 * Text Extractor — extracts text from uploaded files.
 * Supports: PDF, DOCX, CSV, XLSX, images (via Haiku vision).
 */

const mammoth = require('mammoth');
const path = require('path');

/**
 * Extract text from a file buffer based on mimetype/extension
 * @param {Buffer} buffer - file contents
 * @param {string} originalName - original filename
 * @param {string} mimetype - MIME type
 * @returns {{ text: string, type: string }}
 */
async function extractText(buffer, originalName, mimetype) {
  const ext = path.extname(originalName).toLowerCase();
  const type = mimetype || '';

  // CSV / plain text
  if (type.startsWith('text/') || ext === '.csv' || ext === '.txt') {
    return { text: buffer.toString('utf-8'), type: 'text' };
  }

  // JSON
  if (type === 'application/json' || ext === '.json') {
    return { text: buffer.toString('utf-8'), type: 'json' };
  }

  // DOCX
  if (ext === '.docx' || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, type: 'docx' };
  }

  // PDF
  if (ext === '.pdf' || type === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return { text: data.text, type: 'pdf' };
  }

  // XLSX / XLS
  if (ext === '.xlsx' || ext === '.xls' ||
      type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      type === 'application/vnd.ms-excel') {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`[Sheet: ${sheetName}]\n${csv}`);
    }
    return { text: sheets.join('\n\n'), type: 'spreadsheet' };
  }

  // Images — return base64 for Haiku vision
  if (type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    const base64 = buffer.toString('base64');
    const mediaType = type || `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`;
    return { text: null, type: 'image', base64, mediaType };
  }

  return { text: null, type: 'unknown' };
}

module.exports = { extractText };
