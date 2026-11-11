/**
 * Parse CSV text into an array of row objects keyed by header name.
 *
 * Đọc theo chuẩn CSV (RFC 4180) trên TOÀN BỘ nội dung, không cắt theo dòng trước:
 * ô trong dấu ngoặc kép được chứa dấu phẩy/chấm phẩy, dấu "" và cả XUỐNG DÒNG
 * (vd cột Lý do khóa nhiều dòng). Bản cũ cắt file theo \n trước nên ô có xuống
 * dòng bị tách thành dòng rác trong bảng drivers.
 *
 * Tự nhận dấu phân cách phẩy hoặc chấm phẩy (Excel bản tiếng Việt hay dùng ;).
 * Bỏ BOM, bỏ khoảng trắng đầu/cuối mỗi ô, bỏ dòng trống.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, "");
  if (src.trim().length === 0) return [];

  // Dấu phân cách: đếm trên dòng tiêu đề (dòng đầu tiên)
  const firstLineEnd = src.search(/\r?\n/);
  const headerLine = firstLineEnd === -1 ? src : src.slice(0, firstLineEnd);
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    record.push(field.trim());
    field = "";
  };
  const endRecord = () => {
    endField();
    if (record.some((v) => v.length > 0)) records.push(record);
    record = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (ch === "\r") {
        // \r\n bên trong ô -> giữ một \n
        if (src[i + 1] !== "\n") field += "\n";
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n") {
      endRecord();
    } else if (ch === "\r") {
      if (src[i + 1] !== "\n") endRecord();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) endRecord();

  if (records.length === 0) return [];
  const headers = records[0];
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const values = records[r];
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}
