import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { Mutex } from 'async-mutex';
import { v4 as uuid } from 'uuid';

@Injectable()
export class DataStoreService {
  private readonly logger = new Logger(DataStoreService.name);
  private fileLocks = new Map<string, Mutex>();

  /**
   * Get or create a mutex for the given file path
   */
  private getLock(filePath: string): Mutex {
    if (!this.fileLocks.has(filePath)) {
      this.fileLocks.set(filePath, new Mutex());
    }
    return this.fileLocks.get(filePath)!;
  }

  /**
   * Read data from JSON file
   */
  async readFile<T>(filePath: string, dataKey: string): Promise<T[]> {
    const lock = this.getLock(filePath);
    return await lock.runExclusive(async () => {
      try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(fileContent);
        return data[dataKey] || [];
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist, return empty array
          this.logger.warn(`File not found: ${filePath}. Returning empty array.`);
          return [];
        }
        this.logger.error(`Error reading file ${filePath}:`, error);
        throw error;
      }
    });
  }

  /**
   * Write data to JSON file with atomic operation
   */
  async writeFile<T>(filePath: string, dataKey: string, data: T[]): Promise<void> {
    const lock = this.getLock(filePath);
    return await lock.runExclusive(async () => {
      try {
        // Create backup before writing
        await this.createBackup(filePath);

        // Write to temporary file first
        const tempPath = `${filePath}.tmp`;
        const fileContent = JSON.stringify({ [dataKey]: data }, null, 2);
        await fs.writeFile(tempPath, fileContent, 'utf-8');

        // Atomic rename
        await fs.rename(tempPath, filePath);

        this.logger.log(`Successfully wrote ${data.length} records to ${filePath}`);
      } catch (error) {
        this.logger.error(`Error writing file ${filePath}:`, error);
        throw error;
      }
    });
  }

  /**
   * Create backup of file before modification
   */
  private async createBackup(filePath: string): Promise<void> {
    try {
      await fs.access(filePath);
      const backupPath = `${filePath}.backup`;
      await fs.copyFile(filePath, backupPath);
    } catch (error) {
      // File doesn't exist yet, no backup needed
      if (error.code !== 'ENOENT') {
        this.logger.warn(`Could not create backup for ${filePath}:`, error);
      }
    }
  }

  /**
   * Find all records
   */
  async findAll<T>(filePath: string, dataKey: string): Promise<T[]> {
    return await this.readFile<T>(filePath, dataKey);
  }

  /**
   * Find record by ID
   */
  async findById<T extends { id: string }>(
    filePath: string,
    dataKey: string,
    id: string,
  ): Promise<T | null> {
    const records = await this.readFile<T>(filePath, dataKey);
    const record = records.find((r) => r.id === id);
    return record || null;
  }

  /**
   * Find records by condition
   */
  async findBy<T>(
    filePath: string,
    dataKey: string,
    predicate: (item: T) => boolean,
  ): Promise<T[]> {
    const records = await this.readFile<T>(filePath, dataKey);
    return records.filter(predicate);
  }

  /**
   * Find one record by condition
   */
  async findOneBy<T>(
    filePath: string,
    dataKey: string,
    predicate: (item: T) => boolean,
  ): Promise<T | null> {
    const records = await this.readFile<T>(filePath, dataKey);
    const record = records.find(predicate);
    return record || null;
  }

  /**
   * Create new record
   */
  async create<T extends Record<string, any> & { id?: string; createdAt?: string; updatedAt?: string }>(
    filePath: string,
    dataKey: string,
    data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string },
  ): Promise<T> {
    const records = await this.readFile<T>(filePath, dataKey);

    const newRecord = {
      ...data,
      id: data.id || uuid(),
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    } as T;

    records.push(newRecord);
    await this.writeFile(filePath, dataKey, records);

    this.logger.log(`Created new record with ID: ${newRecord.id}`);
    return newRecord;
  }

  /**
   * Update existing record
   */
  async update<T extends Record<string, any> & { id: string; updatedAt?: string }>(
    filePath: string,
    dataKey: string,
    id: string,
    updateData: Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<T> {
    const records = await this.readFile<T>(filePath, dataKey);
    const index = records.findIndex((r) => r.id === id);

    if (index === -1) {
      throw new NotFoundException(`Record with ID ${id} not found`);
    }

    const updatedRecord = {
      ...records[index],
      ...updateData,
      id, // Ensure ID doesn't change
      updatedAt: new Date().toISOString(),
    } as T;

    records[index] = updatedRecord;
    await this.writeFile(filePath, dataKey, records);

    this.logger.log(`Updated record with ID: ${id}`);
    return updatedRecord;
  }

  /**
   * Delete record
   */
  async delete(filePath: string, dataKey: string, id: string): Promise<boolean> {
    const records = await this.readFile(filePath, dataKey);
    const initialLength = records.length;
    const filteredRecords = records.filter((r: any) => r.id !== id);

    if (filteredRecords.length === initialLength) {
      this.logger.warn(`Record with ID ${id} not found for deletion`);
      return false;
    }

    await this.writeFile(filePath, dataKey, filteredRecords);
    this.logger.log(`Deleted record with ID: ${id}`);
    return true;
  }

  /**
   * Count records
   */
  async count(filePath: string, dataKey: string): Promise<number> {
    const records = await this.readFile(filePath, dataKey);
    return records.length;
  }

  /**
   * Check if record exists
   */
  async exists(filePath: string, dataKey: string, id: string): Promise<boolean> {
    const record = await this.findById(filePath, dataKey, id);
    return record !== null;
  }

  /**
   * Bulk create records
   */
  async bulkCreate<T extends Record<string, any> & { id?: string; createdAt?: string; updatedAt?: string }>(
    filePath: string,
    dataKey: string,
    dataArray: (Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string; createdAt?: string; updatedAt?: string })[],
  ): Promise<T[]> {
    const records = await this.readFile<T>(filePath, dataKey);
    const now = new Date().toISOString();

    const newRecords = dataArray.map((data) => ({
      ...data,
      id: data.id || uuid(),
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
    })) as T[];

    records.push(...newRecords);
    await this.writeFile(filePath, dataKey, records);

    this.logger.log(`Bulk created ${newRecords.length} records`);
    return newRecords;
  }

  /**
   * Clear all records (use with caution)
   */
  async clear(filePath: string, dataKey: string): Promise<void> {
    await this.writeFile(filePath, dataKey, []);
    this.logger.warn(`Cleared all records from ${filePath}`);
  }
}
