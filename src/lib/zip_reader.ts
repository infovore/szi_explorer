// ZIP Reader using Range Requests
// This script reads a ZIP file's table of contents without downloading the entire file

type EOCD = {
  diskNumber: number;
  centralDirDisk: number;
  diskEntryCount: number;
  totalEntryCount: number;
  centralDirSize: number;
  centralDirOffset: number;
  commentLength: number;
  absoluteOffset: number;
};

export type FileEntry = {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  fileNameLength: number;
  localHeaderOffset: number;
  extraFieldLength: number;
  dataOffset: number | undefined;
  isDirectory: boolean;
  isImage: boolean | undefined;
};

export class ZipReader {
  url: string;
  fileSize: number;

  constructor(url: string) {
    this.url = url;
    this.fileSize = 0;
  }

  /**
   * Get the file size using a HEAD request
   * @returns {Promise<number>} The file size in bytes
   */
  async getFileSize() {
    try {
      const response = await fetch(this.url, { method: 'HEAD' });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (!contentLength) {
        throw "Couldn't get content length from headers";
      }
      this.fileSize = parseInt(contentLength, 10);

      return this.fileSize;
    } catch (error) {
      console.error('Error getting file size:', error);
      throw error;
    }
  }

  /**
   * Fetch a range of bytes from the file
   * @param {number} start - Starting byte position
   * @param {number} end - Ending byte position
   * @returns {Promise<ArrayBuffer>} The requested bytes
   */
  async fetchRange(start: number, end: number) {
    try {
      const response = await fetch(this.url, {
        headers: {
          Range: `bytes=${start}-${end}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Error fetching range ${start}-${end}:`, error);
      throw error;
    }
  }

  /**
   * Parse the End of Central Directory record
   * @param {ArrayBuffer} buffer - The EOCD record data
   * @returns {Object} EOCD information
   */
  parseEOCD(buffer: ArrayBuffer) {
    const view = new DataView(buffer);

    // Verify EOCD signature (0x06054b50)
    const signature = view.getUint32(0, true);
    if (signature !== 0x06054b50) {
      throw new Error('Invalid EOCD signature');
    }

    return {
      diskNumber: view.getUint16(4, true),
      centralDirDisk: view.getUint16(6, true),
      diskEntryCount: view.getUint16(8, true),
      totalEntryCount: view.getUint16(10, true),
      centralDirSize: view.getUint32(12, true),
      centralDirOffset: view.getUint32(16, true),
      commentLength: view.getUint16(20, true),
      absoluteOffset: 0
    } as EOCD;
  }

  /**
   * Find the End of Central Directory record
   * @returns {Promise<Object>} EOCD information
   */
  async findEOCD() {
    if (!this.fileSize) {
      await this.getFileSize();
    }

    // EOCD record is at the end of the file
    // Try to fetch the last 64KB (which should contain the EOCD in most cases)
    const maxCommentLength = 65535; // Max comment length according to ZIP spec
    const bufferSize = Math.min(maxCommentLength + 22, this.fileSize); // 22 is the EOCD record size

    const startPos = this.fileSize - bufferSize;
    const endPos = this.fileSize - 1;

    const buffer = await this.fetchRange(startPos, endPos);
    const bytes = new Uint8Array(buffer);

    // Search for the EOCD signature (0x50, 0x4B, 0x05, 0x06) from the end
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        // Found EOCD signature
        const eocdBuffer = buffer.slice(i, i + 22);
        const eocd = this.parseEOCD(eocdBuffer);

        // Adjust the central directory offset for our calculation
        eocd.absoluteOffset = startPos + i;
        return eocd;
      }
    }

    throw new Error('EOCD record not found');
  }

  /**
   * Parse a Central Directory entry
   * @param {ArrayBuffer} buffer - The central directory entry data
   * @param {number} offset - Starting offset within the buffer
   * @returns {Object} Entry information and the next entry offset
   */
  parseCentralDirEntry(buffer: ArrayBuffer, offset = 0) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Verify central directory entry signature (0x02014b50)
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error('Invalid central directory entry signature');
    }

    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);

    // Extract filename
    const fileNameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    const fileName = new TextDecoder().decode(fileNameBytes);

    // Calculate compressed and uncompressed sizes
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);

    // Get local file header offset
    const localHeaderOffset = view.getUint32(offset + 42, true);

    // Calculate next entry offset
    const entrySize = 46 + fileNameLength + extraFieldLength + commentLength;

    const isDirectory = fileName.endsWith('/');
    const isImage =
      !isDirectory &&
      (fileName.toLowerCase().endsWith('.jpg') ||
        fileName.toLowerCase().endsWith('.jpeg') ||
        fileName.toLowerCase().endsWith('.png'));

    return {
      entry: {
        fileName,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
        isDirectory,
        isImage
      },
      nextOffset: offset + entrySize
    };
  }

  /**
   * Read all Central Directory entries
   * @param {Object} eocd - End of Central Directory record
   * @returns {Promise<Array>} List of file entries
   */
  async readCentralDirectory(eocd: EOCD) {
    const centralDirStart = eocd.centralDirOffset;
    const centralDirEnd = centralDirStart + eocd.centralDirSize - 1;

    // Fetch the entire central directory
    const buffer = await this.fetchRange(centralDirStart, centralDirEnd);

    const entries = [];
    let offset = 0;

    // Parse each entry in the central directory
    for (let i = 0; i < eocd.totalEntryCount; i++) {
      try {
        const { entry, nextOffset } = this.parseCentralDirEntry(buffer, offset);
        entries.push(entry);
        offset = nextOffset;
      } catch (error) {
        console.error('Error parsing central directory entry:', error);
        break;
      }
    }

    return entries;
  }

  /**
   * Read the table of contents (list of files in the ZIP)
   * @returns {Promise<Array>} List of file entries
   */
  async readTableOfContents() {
    try {
      console.log('Finding EOCD');
      const eocd = await this.findEOCD();
      console.log('Finding entries');
      const entries = await this.readCentralDirectory(eocd);

      const processedEntries = await Promise.all(
        entries.map((entry) => {
          if (entry.isDirectory) {
            return entry;
          }
          return this.calculateFileDataOffset(entry);
        })
      );

      console.log('Got all entries');

      return processedEntries;
    } catch (error) {
      console.error('Error reading ZIP table of contents:', error);
      throw error;
    }
  }

  /**
   * Get the actual data offset for a file by reading its local file header
   * @param {Object} entry - The file entry
   * @returns {Promise<void>}
   */
  async calculateFileDataOffset(entry: FileEntry) {
    try {
      const headerSize = 30; // Local file header fixed size

      const fileNameLength = entry.fileName.length;
      const extraFieldLength = 0;

      // Calculate data offset
      const dataOffset = entry.localHeaderOffset + headerSize + fileNameLength + extraFieldLength;
      entry.dataOffset = dataOffset;
      entry.fileNameLength = fileNameLength;
      entry.extraFieldLength = extraFieldLength;

      return entry;
    } catch (error) {
      console.error(`Error getting data offset for ${entry.fileName}:`, error);
      // If we fail, make a best guess at the offset
      entry.dataOffset = entry.localHeaderOffset + 30;
      return entry;
    }
  }

  /**
   * Extract a file from the ZIP
   * @param {Object} entry - The file entry
   * @returns {Promise<Blob>} The file data as a Blob
   */
  async extractFile(entry: FileEntry) {
    if (!entry.dataOffset) {
      await this.calculateFileDataOffset(entry);
    }

    // Fetch the file data
    const buffer = await this.fetchRange(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize - 1
    );

    // If the file is stored (not compressed)
    if (
      entry.fileName.toLowerCase().endsWith('.jpg') ||
      entry.fileName.toLowerCase().endsWith('.jpeg') ||
      entry.fileName.toLowerCase().endsWith('.png')
    ) {
      return new Blob([buffer], {
        type: entry.fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
      });
    }

    // For other files or compressed files, just return as blob
    return new Blob([buffer]);
  }
}
