import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import axios from 'axios';

export class GoogleDriveDownloader {
  static async downloadPublicFile(
    url: string,
    destinationPath: string
  ): Promise<string> {
    const fileId = this.extractFileIdFromUrl(url);
    if (!fileId) {
      throw new Error('Invalid Google Drive URL');
    }

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const tempDir = path.join(destinationPath, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, `${fileId}.pdf`);

    try {
      logger.info('Downloading public Google Drive file', { downloadUrl });
      const response = await axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'arraybuffer',
      });

      logger.debug('Downloaded file data', { size: response.data.length });
      fs.writeFileSync(tempFilePath, response.data);
      logger.info('Finished writing downloaded file to disk.', { fileId, tempFilePath });
      return tempFilePath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Google Drive download error', { fileId, error: errorMessage });
      throw new Error(`Failed to download file: ${errorMessage}`);
    }
  }

  static extractFileIdFromUrl(url: string): string | null {
    const regex = /\/file\/d\/([a-zA-Z0-9_-]+)/;
    const match = url.match(regex);
    return match?.[1] || null;
  }
}