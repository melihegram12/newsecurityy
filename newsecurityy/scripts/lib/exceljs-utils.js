const ExcelJS = require('exceljs');

function normalizeExcelValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (Array.isArray(value?.richText)) {
    return value.richText.map((part) => part?.text || '').join('');
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return normalizeExcelValue(value.result);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return normalizeExcelValue(value.text);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'hyperlink')) {
      return normalizeExcelValue(value.text || value.hyperlink);
    }
  }
  return value;
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

function worksheetToArrayRows(worksheet) {
  if (!worksheet) return [];
  const columnCount = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0);
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let column = 1; column <= columnCount; column += 1) {
      values.push(normalizeExcelValue(row.getCell(column).value));
    }
    rows.push(values);
  });
  return rows;
}

function worksheetToObjectRows(worksheet) {
  const rows = worksheetToArrayRows(worksheet);
  if (rows.length === 0) return [];
  const headers = rows[0].map((value, index) => {
    const header = String(normalizeExcelValue(value) || '').trim();
    return header || `Column ${index + 1}`;
  });
  return rows.slice(1).map((values) => (
    headers.reduce((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {})
  ));
}

async function readFirstWorksheetRows(filePath) {
  const workbook = await readWorkbook(filePath);
  return worksheetToObjectRows(workbook.worksheets[0]);
}

async function readWorkbookArraySheets(filePath) {
  const workbook = await readWorkbook(filePath);
  return workbook.worksheets.reduce((sheets, worksheet) => {
    sheets[worksheet.name] = worksheetToArrayRows(worksheet);
    return sheets;
  }, {});
}

module.exports = {
  readFirstWorksheetRows,
  readWorkbookArraySheets,
};
