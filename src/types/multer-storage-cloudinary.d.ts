declare module 'multer-storage-cloudinary' {
  import { StorageEngine } from 'multer';
  import { Request } from 'express';

  export interface Options {
    cloudinary: any;
    params?:
      | Record<string, any>
      | ((
          req: Request,
          file: Express.Multer.File
        ) => Record<string, any> | Promise<Record<string, any>>);
  }

  export class CloudinaryStorage implements StorageEngine {
    constructor(options: Options);
    _handleFile(
      req: Request,
      file: Express.Multer.File,
      callback: (error?: any, info?: any) => void
    ): void;
    _removeFile(
      req: Request,
      file: Express.Multer.File,
      callback: (error: Error | null) => void
    ): void;
  }
}
