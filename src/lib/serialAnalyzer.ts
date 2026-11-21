const MAX_LINE_BYTES = 8192;
const MAX_FIELDS = 32;
const MAX_SAMPLES = 300;

export interface NumericSample {
  line: number;
  fields: ReadonlyMap<string, number>;
}

function delimitedFields(line: string): string[] {
  let inQuotes = false;
  const separators = new Set<string>();
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "\t" || char === ";" || char === ",")) separators.add(char);
  }
  if (inQuotes) return [];
  const delimiter = separators.has("\t") ? "\t" : separators.has(";") ? ";" : ",";
  const fields: string[] = [];
  let field = "";
  for (let i = 0; i < line.length && fields.length < MAX_FIELDS; i++) {
    const char = line[i];
    if (char === '"' && inQuotes && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && char === delimiter) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  if (fields.length < MAX_FIELDS) fields.push(field.trim());
  return fields;
}

export function numericFields(line: string): ReadonlyMap<string, number> {
  const fields = new Map<string, number>();
  const text = line.trim();
  if (text.startsWith("{")) {
    try {
      const object: Record<string, unknown> = JSON.parse(text);
      for (const [key, value] of Object.entries(object)) {
        if (fields.size === MAX_FIELDS) break;
        if (key && typeof value === "number" && Number.isFinite(value)) fields.set(key, value);
      }
    } catch { /* Skip malformed structured lines. */ }
    return fields;
  }
  for (const [index, field] of delimitedFields(line).entries()) {
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(field)) {
      const number = Number(field);
      if (Number.isFinite(number)) fields.set(`#${index + 1}`, number);
    }
  }
  return fields;
}

export class SerialAnalyzerBuffer {
  private readonly decoder = new TextDecoder();
  private readonly buffer = new Uint8Array(MAX_LINE_BYTES);
  private length = 0;
  private skipLine = false;
  private afterCr = false;
  private readonly history: NumericSample[] = [];
  private line = 0;
  private overlong = 0;

  receive(bytes: Uint8Array) {
    for (const byte of bytes) {
      if (byte === 10 || byte === 13) {
        if (byte === 10 && this.afterCr) {
          this.afterCr = false;
          continue;
        }
        this.afterCr = byte === 13;
        this.line++;
        if (!this.skipLine) {
          const fields = numericFields(this.decoder.decode(this.buffer.subarray(0, this.length)));
          if (fields.size) {
            if (this.history.length === MAX_SAMPLES) this.history.shift();
            this.history.push({ line: this.line, fields });
          }
        }
        this.length = 0;
        this.skipLine = false;
      } else {
        this.afterCr = false;
        if (this.skipLine) continue;
        if (this.length >= this.buffer.length) {
          this.skipLine = true;
          this.overlong++;
        } else {
          this.buffer[this.length++] = byte;
        }
      }
    }
  }

  snapshot() {
    return { samples: this.history.slice(), lines: this.line, overlong: this.overlong };
  }
}
