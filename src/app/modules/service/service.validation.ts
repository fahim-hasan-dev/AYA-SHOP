import { z } from "zod";

const createServiceSchema = z.object({
    body: z.object({
        name: z.string().min(1, "Service name is required"),
        category: z.string().min(1, "Category is required"),
        description: z.string().min(1, "Description is required"),
        price: z.number().min(0, "Price must be a positive number"),
        duration: z.string().min(1, "Duration is required"),
        maxBookingsPerDay: z.number().min(1, "Max bookings per day must be at least 1"),
        photos: z.array(z.string()).min(1, "At least one photo is required").max(5, "Max 5 photos allowed"),
        features: z.array(z.string()).optional(),
        clientRequirements: z.string().min(1, "Client requirements are required"),
        cancellationPolicy: z.string().min(1, "Cancellation policy is required"),
        serviceType: z.enum(["paid", "unpaid"]),
        isActive: z.boolean().optional(),
    }),
});

const updateServiceSchema = z.object({
    body: z.object({
        name: z.string().optional(),
        category: z.string().optional(),
        description: z.string().optional(),
        price: z.number().min(0).optional(),
        duration: z.string().optional(),
        maxBookingsPerDay: z.number().min(1).optional(),
        photos: z.array(z.string()).max(5).optional(),
        features: z.array(z.string()).optional(),
        clientRequirements: z.string().optional(),
        cancellationPolicy: z.string().optional(),
        serviceType: z.enum(["paid", "unpaid"]).optional(),
        isActive: z.boolean().optional(),
    }),
});

export const ServiceValidation = {
    createServiceSchema,
    updateServiceSchema,
};
