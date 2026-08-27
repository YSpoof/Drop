import { WriteStream } from "node:fs";

export type OpenStream = {
  stream: WriteStream;
  path: string;
};