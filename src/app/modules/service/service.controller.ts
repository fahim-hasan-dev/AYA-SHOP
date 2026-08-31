import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";
import { ServiceService } from "./service.service";

const createService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.createServiceToDB(req.user.authId, req.body);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Service created successfully",
        data: result,
    });
});

const getAllServices = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getAllPublicServicesFromDB(req.query);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Services retrieved successfully",
        meta: result.meta,
        data: result.result,
    });
});

const getMyServices = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getMyServicesFromDB(req.user.authId, req.query);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "My services retrieved successfully",
        meta: result.meta,
        data: result.result,
    });
});

const getAdminServices = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getAdminServicesFromDB(req.query);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "All services retrieved successfully",
        meta: result.meta,
        data: result.result,
    });
});

const getSingleService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getSingleServiceFromDB(req.params.id, req.user);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Service retrieved successfully",
        data: result,
    });
});

const updateService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.updateServiceInDB(req.params.id, (req as any).user.authId, req.body);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Service updated successfully",
        data: result,
    });
});

const getAvailableSlots = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getAvailableSlotsFromDB(req.params.id, req.query.date as string);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Available slots fetched successfully",
        data: result,
    });
});

const deleteService = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.deleteServiceFromDB(req.user, req.params.id);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Service deleted successfully",
        data: result,
    });
});

const getTopRatedServices = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.getTopRatedServicesFromDB(req.query);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Top rated services retrieved successfully",
        meta: result.meta,
        data: result.result,
    });
});

const toggleServiceStatus = catchAsync(async (req: Request, res: Response) => {
    const result = await ServiceService.toggleServiceStatusInDB(req.params.id, req.user);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: "Service status toggled successfully",
        data: result,
    });
});

export const ServiceController = {
    createService,
    getAllServices,
    getMyServices,
    getAdminServices,
    getSingleService,
    updateService,
    deleteService,
    getAvailableSlots,
    getTopRatedServices,
    toggleServiceStatus,
};
