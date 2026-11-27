import type { StorageBackend, StorageFileHint } from './index.js';
export declare class OPFSBackend implements StorageBackend {
    isSupported(): boolean;
    read(key: string): Promise<Blob | null>;
    write(key: string, stream: ReadableStream, _hint?: StorageFileHint, offset?: number): Promise<void>;
    canWriteAt(): boolean;
    getSize(key: string): Promise<number>;
    list(): Promise<Array<{
        key: string;
        size: number;
    }>>;
    delete(key: string): Promise<void>;
}
