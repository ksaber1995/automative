import { Module, Global } from '@nestjs/common';
import { DataStoreService } from './data-store.service';

@Global()
@Module({
  providers: [DataStoreService],
  exports: [DataStoreService],
})
export class DataStoreModule {}
