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

async function loadExcelJS() {
  const module = await import('exceljs');
  return module.default || module;
}

function worksheetToRows(worksheet) {
  if (!worksheet) return [];
  const columnCount = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0);
  if (columnCount <= 0) return [];

  const matrix = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    for (let column = 1; column <= columnCount; column += 1) {
      values.push(normalizeExcelValue(row.getCell(column).value));
    }
    matrix.push(values);
  });

  if (matrix.length === 0) return [];
  const headers = matrix[0].map((value, index) => {
    const header = String(normalizeExcelValue(value) || '').trim();
    return header || `Column ${index + 1}`;
  });

  return matrix.slice(1).map((values) => (
    headers.reduce((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {})
  ));
}

export async function readExcelRowsFromBuffer(buffer) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return worksheetToRows(workbook.worksheets[0]);
}

export async function writeRowsToExcelFile(rows, sheetName, fileName) {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName || 'Rapor');
  const dataRows = Array.isArray(rows) ? rows : [];
  const headers = Object.keys(dataRows[0] || {});

  if (headers.length > 0) {
    worksheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: Math.max(12, Math.min(32, String(header).length + 4)),
    }));
    dataRows.forEach((row) => worksheet.addRow(row));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
