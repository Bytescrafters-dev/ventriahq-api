import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from 'src/common/guards/admin.guard';
import { StoresService } from './stores.service';
import { CreateStoreDto } from './dtos/create-store.dto';
import { UpdateStoreDto } from './dtos/update-store.dto';
import { Roles, RolesGuard } from 'src/common/auth';
import { AdminRole } from '@prisma/client';

interface AuthedRequest {
  user: { sub: string; tenantId: string | null };
}

@Controller('stores')
@UseGuards(AdminGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @UseGuards(RolesGuard)
  @Roles(AdminRole.OWNER)
  @Post()
  createStore(@Body() data: CreateStoreDto, @Req() req: AuthedRequest) {
    return this.storesService.createStore(data, req.user.sub);
  }

  @Get()
  getAllStores(@Req() req: AuthedRequest) {
    return this.storesService.getAllStores(req.user.sub);
  }

  @Get(':id')
  getStoreById(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.storesService.getStoreById(id, req.user.tenantId);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.OWNER, AdminRole.MANAGER)
  updateStore(
    @Param('id') id: string,
    @Body() data: UpdateStoreDto,
    @Req() req: AuthedRequest,
  ) {
    return this.storesService.updateStore(id, data, req.user.tenantId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.OWNER)
  deleteStore(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.storesService.deleteStore(id, req.user.tenantId);
  }
}
