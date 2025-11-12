#!/usr/bin/env python3
"""
Fixes groundTruthService.ts to parse JSON pointer files correctly
"""

import re

file_path = "src/services/groundTruthService.ts"

# Read the file
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and replace the loadFromS3 method's pointer parsing logic
old_code = '''      const pointerResponse = await this.s3Client.send(pointerCommand);
      const actualPath = await pointerResponse.Body?.transformToString();

      if (!actualPath) {
        logger.warn(`Pointer file ${pointerKey} is empty`);
        return [];
      }

      const trimmedPath = actualPath.trim();
      logger.info(`Loading ground truth from: ${trimmedPath}`);

      // Load the actual CSV file
      const dataCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: trimmedPath,
      });'''

new_code = '''      const pointerResponse = await this.s3Client.send(pointerCommand);
      const pointerContent = await pointerResponse.Body?.transformToString();

      if (!pointerContent) {
        logger.warn(`Pointer file ${pointerKey} is empty`);
        return [];
      }

      const trimmedContent = pointerContent.trim();
      let actualPath: string;

      // Check if pointer is JSON format (new format) or plain text (legacy)
      if (trimmedContent.startsWith('{')) {
        try {
          const pointer = JSON.parse(trimmedContent);
          // Extract key from s3_uri (format: s3://bucket/key)
          const s3Uri = pointer.s3_uri;
          if (!s3Uri) {
            logger.warn(`Pointer file ${pointerKey} has no s3_uri field`);
            return [];
          }
          // Extract key from URI
          const match = s3Uri.match(/^s3:\\/\\/[^/]+\\/(.+)$/);
          if (!match) {
            logger.warn(`Invalid s3_uri format in pointer: ${s3Uri}`);
            return [];
          }
          actualPath = match[1];
          logger.info(`Loading ground truth from pointer:`, { version: pointer.version, s3Uri });
        } catch (parseError) {
          logger.error(`Failed to parse JSON pointer file ${pointerKey}`, { parseError });
          return [];
        }
      } else {
        // Legacy plain text format
        actualPath = trimmedContent;
        logger.info(`Loading ground truth from: ${trimmedContent}`);
      }

      // Load the actual CSV file
      const dataCommand = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: actualPath,
      });'''

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("[OK] Fixed groundTruthService.ts to parse JSON pointer files")
else:
    print("[ERROR] Could not find the code to replace")
    print("The file may have been modified already or has a different format")
