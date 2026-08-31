import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiError";
import { IService } from "./service.interface";
import { Service } from "./service.model";
import { Booking } from "../booking/booking.model";
import QueryBuilder from "../../builder/QueryBuilder";
import { CategoryModel } from "../category/category.model";
import { JwtPayload } from "jsonwebtoken";
import { USER_ROLES } from "../user/user.interface";
import mongoose from "mongoose";
import { ViewHistory } from "../viewHistory/viewHistory.model";
import dayjs from "dayjs";


const createServiceToDB = async (providerId: string, payload: IService) => {
    payload.provider = providerId as any;
    const isExistCategory = await CategoryModel.findById(payload.category);
    if (!isExistCategory) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Category not found");
    }
    const result = await Service.create(payload);
    return result;
};


const buildServicePipeline = (matchStage: Record<string, any>, query: Record<string, unknown>) => {
    const pipeline: any[] = [];

    // 1. Match services based on query / match stage
    if (Object.keys(matchStage).length > 0) {
        pipeline.push({ $match: matchStage });
    }

    // 2. Lookup provider details
    pipeline.push({
        $lookup: {
            from: "users",
            localField: "provider",
            foreignField: "_id",
            as: "providerInfo",
            pipeline: [
                {
                    $project: {
                        fullName: 1,
                        email: 1,
                        image: 1,
                        "business.businessName": 1,
                        "business.logo": 1,
                        "business.address": 1,
                        "business.city": 1,
                        "business.state": 1,
                        "business.zipCode": 1,
                        "business.businessStatus": 1
                    }
                }
            ]
        }
    });
    pipeline.push({ $unwind: "$providerInfo" });

    // 3. Lookup category details
    pipeline.push({
        $lookup: {
            from: "categories",
            localField: "category",
            foreignField: "_id",
            as: "categoryInfo",
            pipeline: [
                {
                    $project: {
                        name: 1,
                        slug: 1,
                        icon: 1
                    }
                }
            ]
        }
    });
    pipeline.push({ $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } });

    // 4. Apply location filters
    if (query.state || query.city || query.zipCode) {
        const locationMatch: any = {};
        if (query.state) locationMatch["providerInfo.business.state"] = { $regex: query.state, $options: "i" };
        if (query.city) locationMatch["providerInfo.business.city"] = { $regex: query.city, $options: "i" };
        if (query.zipCode) locationMatch["providerInfo.business.zipCode"] = query.zipCode;
        pipeline.push({ $match: locationMatch });
    }

    // 5. Apply search
    if (query.searchTerm) {
        pipeline.push({
            $match: {
                $or: [
                    { name: { $regex: query.searchTerm, $options: "i" } },
                    { "categoryInfo.name": { $regex: query.searchTerm, $options: "i" } }
                ]
            }
        });
    }

    // 6. Apply other filters
    if (query.category) {
        pipeline.push({
            $match: {
                category: new mongoose.Types.ObjectId(query.category as string)
            }
        });
    }

    if (query.minPrice || query.maxPrice) {
        const priceMatch: any = {};
        if (query.minPrice) priceMatch.$gte = Number(query.minPrice);
        if (query.maxPrice) priceMatch.$lte = Number(query.maxPrice);
        pipeline.push({ $match: { price: priceMatch } });
    }

    if (query.isActive !== undefined) {
        pipeline.push({
            $match: {
                isActive: query.isActive === "true" || query.isActive === true
            }
        });
    }

    // 7. Project required service fields
    pipeline.push({
        $project: {
            name: 1,
            description: 1,
            price: 1,
            duration: 1,
            photos: 1,
            features: 1,
            rating: 1,
            bookingCount: 1,
            providerInfo: 1,
            categoryInfo: 1,
            isActive: 1,
            serviceType: 1,
            createdAt: 1,
            updatedAt: 1
        }
    });

    // 8. Sorting
    const sortField = (query.sort as string) || "-createdAt";
    const sortOrder = sortField.startsWith("-") ? -1 : 1;
    const sortKey = sortField.replace("-", "");
    pipeline.push({ $sort: { [sortKey]: sortOrder } });

    return pipeline;
};

const executeServiceAggregate = async (pipeline: any[], query: Record<string, unknown>) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const countResult = await Service.aggregate([
        ...pipeline.slice(0, -2), // Remove project and sort stages for count
        { $count: "total" }
    ]);
    const total = countResult[0]?.total || 0;

    const paginatedPipeline = [
        ...pipeline,
        { $skip: skip },
        { $limit: limit }
    ];

    const result = await Service.aggregate(paginatedPipeline);

    return {
        meta: {
            total,
            page,
            limit,
            totalPage: Math.ceil(total / limit)
        },
        result
    };
};

const getAllPublicServicesFromDB = async (query: Record<string, unknown>) => {
    const pipeline = buildServicePipeline({ isActive: true }, query);
    return await executeServiceAggregate(pipeline, query);
};

const getMyServicesFromDB = async (providerId: string, query: Record<string, unknown>) => {
    const pipeline = buildServicePipeline(
        { provider: new mongoose.Types.ObjectId(providerId) },
        query
    );
    return await executeServiceAggregate(pipeline, query);
};

const getAdminServicesFromDB = async (query: Record<string, unknown>) => {
    const pipeline = buildServicePipeline({}, query);
    return await executeServiceAggregate(pipeline, query);
};

const getAllServicesFromDB = async (user: any, query: Record<string, unknown>) => {
    if (user?.role === USER_ROLES.BUSINESS && user?.authId) {
        return getMyServicesFromDB(user.authId, query);
    }
    if (user?.role === USER_ROLES.ADMIN) {
        return getAdminServicesFromDB(query);
    }
    return getAllPublicServicesFromDB(query);
};

const getSingleServiceFromDB = async (id: string, user: JwtPayload) => {
    const result = await Service.findById(id).populate([
        { path: 'category', select: ' _id name icon' },
        {
            path: 'provider',
            select: '_id fullName email image phone business.businessName business.logo business.address business.city business.state business.zipCode business.businessStatus'
        }
    ]);
    if (!result) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    // Check if service is active - only for clients
    if (user.role === USER_ROLES.CLIENT && !result.isActive) {
        throw new ApiError(StatusCodes.FORBIDDEN, "This service is currently inactive");
    }

    // Tracking views - Only for clients
    if (user.role === USER_ROLES.CLIENT) {
        const today = dayjs().format('YYYY-MM-DD');
        await ViewHistory.findOneAndUpdate(
            {
                service: result._id,
                date: today
            },
            {
                $inc: { count: 1 },
                $setOnInsert: { provider: (result as any).provider._id || result.provider }
            },
            { upsert: true, new: true }
        );
    }

    // Add statistics for business owner
    if (user.role === USER_ROLES.BUSINESS && result.provider._id.toString() === user.authId) {
        console.log("Business owner")
        const totalViews = await ViewHistory.aggregate([
            { $match: { service: result._id } },
            { $group: { _id: null, total: { $sum: "$count" } } }
        ]);

        const bookingsData = await Booking.aggregate([
            { $match: { service: result._id } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    revenue: { $sum: "$totalAmount" }
                }
            }
        ]);

        return {
            ...result.toObject(),
            statistics: {
                isActive: result.isActive,
                totalViews: totalViews[0]?.total || 0,
                revenue: bookingsData[0]?.revenue || 0
            }
        };
    }

    return result;
};

const getAvailableSlotsFromDB = async (serviceId: string, date: string) => {
    const service = await Service.findById(serviceId).populate("provider");
    if (!service) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    if (!service.isActive) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Service is currently inactive");
    }

    const provider = service.provider as any;
    if (!provider || !provider.business || !provider.business.businessHours) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Provider business hours not configured");
    }

    const dayOfWeek = new Date(date).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const businessHours = (provider.business.businessHours as any)[dayOfWeek];

    if (!businessHours || !businessHours.from || !businessHours.to) {
        return []; // Closed on this day
    }

    // Parse duration (e.g., "30 min", "1 hour", or just "30")
    const durationMatch = service.duration.match(/\d+/);
    const durationInMinutes = durationMatch ? parseInt(durationMatch[0]) : 30;

    const slots = [];
    let current = businessHours.from;
    const end = businessHours.to;

    const parseTime = (time: string) => {
        const [hours, minutes] = time.split(":").map(Number);
        return hours * 60 + minutes;
    };

    const formatTime = (totalMinutes: number) => {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    };

    let currentMinutes = parseTime(current);
    const endMinutes = parseTime(end);

    while (currentMinutes + durationInMinutes <= endMinutes) {
        const slotFrom = formatTime(currentMinutes);
        const slotTo = formatTime(currentMinutes + durationInMinutes);

        // Check availability in Booking model
        const isBooked = await Booking.findOne({
            service: serviceId,
            date,
            startTime: slotFrom,
            status: { $ne: "cancelled" },
        });

        slots.push({
            from: slotFrom,
            to: slotTo,
            status: isBooked ? "booked" : "available",
        });

        currentMinutes += durationInMinutes;
    }

    return slots;
};

const getTopRatedServicesFromDB = async (query: Record<string, unknown>) => {
    const mergedQuery = { sort: "-rating.averageRating", ...query };

    const queryWithFilter = { ...query, isActive: true };

    const serviceQuery = new QueryBuilder(
        Service.find()
            .populate({ path: "category", select: "name icon" })
            .populate({
                path: "provider",
                select: "fullName image business.businessName business.logo business.city business.state business.zipCode",
            }),
        mergedQuery
    )
        .search(["name", "description"])
        .filter()
        .sort()
        .paginate()
        .fields();

    // Ensure we only get active services for top rated list
    serviceQuery.modelQuery = serviceQuery.modelQuery.where({ isActive: true });

    const result = await serviceQuery.modelQuery;
    const meta = await serviceQuery.getPaginationInfo();

    return { meta, result };
    
};


const updateServiceInDB = async (id: string, providerId: string, payload: Partial<IService>) => {
    const isExist = await Service.findById(id);
    if (!isExist) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    if (isExist.provider.toString() !== providerId) {
        throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to update this service");
    }

    const result = await Service.findByIdAndUpdate(id, payload, {
        new: true,
        runValidators: true,
    });
    return result;
};

const toggleServiceStatusInDB = async (id: string, user: JwtPayload) => {
    const isExist = await Service.findById(id);
    if (!isExist) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    if (user.role === USER_ROLES.BUSINESS && isExist.provider.toString() !== user.authId) {
        throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to toggle this service");
    }

    const result = await Service.findByIdAndUpdate(
        id,
        { isActive: !isExist.isActive },
        { new: true }
    );
    return result;
};


const deleteServiceFromDB = async (user: JwtPayload, id: string) => {
    const isExist = await Service.findById(id);
    if (!isExist) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    if (user.role === USER_ROLES.BUSINESS && isExist.provider.toString() !== user.authId) {
        throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to delete this service");
    }

    const result = await Service.findByIdAndDelete(id);
    return result;
};



export const ServiceService = {
    createServiceToDB,
    getAllServicesFromDB,
    getAllPublicServicesFromDB,
    getMyServicesFromDB,
    getAdminServicesFromDB,
    getSingleServiceFromDB,
    updateServiceInDB,
    deleteServiceFromDB,
    getAvailableSlotsFromDB,
    getTopRatedServicesFromDB,
    toggleServiceStatusInDB,
};
