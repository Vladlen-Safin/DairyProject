import { SaxesParser, SaxesTagPlain } from "saxes";

interface Frame {
  tagName: string;
  children: Record<string, unknown[]>;
  text: string;
}

export interface AbortSignalLike {
  aborted: boolean;
}

export interface ChunkedXmlReaderOptions {
  /** Путь тегов от корня документа, на котором собираем объект целиком, например ["file","events","event"] */
  collectPath: string[];
  /** Вызывается на каждый собранный элемент. Пока promise не разрешится, чтение файла приостановлено (backpressure). */
  onItem: (item: Record<string, unknown>) => Promise<void> | void;
  /** Позволяет остановить чтение раньше конца файла (например, по исчерпанному бюджету времени) */
  signal?: AbortSignalLike;
}

function pathMatches(pathStack: string[], collectPath: string[]): boolean {
  if (pathStack.length !== collectPath.length) return false;
  for (let i = 0; i < collectPath.length; i++) {
    if (pathStack[i] !== collectPath[i]) return false;
  }
  return true;
}

function buildValue(frame: Frame): unknown {
  const keys = Object.keys(frame.children);
  if (keys.length === 0) return frame.text.trim();
  const obj: Record<string, unknown> = {};
  for (const key of keys) {
    const arr = frame.children[key]!;
    obj[key] = arr.length === 1 ? arr[0] : arr;
  }
  return obj;
}

/**
 * Потоково читает XML и собирает в JS-объекты только элементы по пути collectPath.
 * Остальной документ в памяти не удерживается - в отличие от simplexml_load_file()
 * в PHP-версии, файл на 20 000+ строк никогда не грузится в память целиком.
 */
export function readChunkedXml(
  readable: NodeJS.ReadableStream,
  opts: ChunkedXmlReaderOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = new SaxesParser();
    const stack: Frame[] = [];
    const pathStack: string[] = [];
    let collecting = false;
    let collectDepth = -1;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      (readable as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      err ? reject(err) : resolve();
    };

    parser.on("opentag", (tag: SaxesTagPlain) => {
      pathStack.push(tag.name);
      if (!collecting && pathMatches(pathStack, opts.collectPath)) {
        collecting = true;
        collectDepth = pathStack.length;
      }
      if (collecting) stack.push({ tagName: tag.name, children: {}, text: "" });
    });

    parser.on("text", (t: string) => {
      if (collecting && stack.length) stack[stack.length - 1]!.text += t;
    });

    parser.on("closetag", () => {
      if (collecting) {
        const frame = stack.pop()!;
        const value = buildValue(frame);
        if (stack.length > 0) {
          const parent = stack[stack.length - 1]!;
          (parent.children[frame.tagName] ??= []).push(value);
        } else {
          readable.pause();
          Promise.resolve(opts.onItem(value as Record<string, unknown>))
            .then(() => {
              if (opts.signal?.aborted) {
                finish();
                return;
              }
              readable.resume();
            })
            .catch(finish);
        }
      }
      pathStack.pop();
      if (collecting && pathStack.length < collectDepth) {
        collecting = false;
        collectDepth = -1;
      }
    });

    parser.on("error", finish);

    readable.on("data", (chunk: Buffer) => {
      try {
        parser.write(chunk.toString("utf-8"));
      } catch (err) {
        finish(err as Error);
      }
    });

    readable.on("end", () => {
      try {
        parser.close();
      } catch (err) {
        finish(err as Error);
        return;
      }
      finish();
    });

    readable.on("error", finish);
  });
}