import { Types } from "mongoose";

export type IService = {
    name: string;
    category: Types.ObjectId;
    description: string;
    price: number;
    duration: string;
    maxBookingsPerDay: number;
    photos: string[];
    features: string[];
    clientRequirements: string;
    cancellationPolicy: string;
    bookingCount: number;
    provider: Types.ObjectId;
    rating: {
        total: number;
        averageRating: number;
    };
    isActive: boolean;
    serviceType: "paid" | "unpaid";
};
