import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiError";
import { IBooking } from "./booking.interface";
import { Booking } from "./booking.model";
import { BOOKING_STATUS, PAYMENT_STATUS } from "../../../enum/booking";
import { Service } from "../service/service.model";
import { User } from "../user/user.model";
import QueryBuilder from "../../builder/QueryBuilder";
import { NotificationService } from "../notification/notification.service";
import { initiateStripeTransfer } from "../../../stripe/stripeTransfer";
import { initiateStripeRefund } from "../../../stripe/stripeRefund";
import { logger } from "../../../shared/logger";
import stripe from "../../../config/stripe";
import Stripe from "stripe";
import { JwtPayload } from "jsonwebtoken";
import { USER_ROLES } from "../user/user.interface";

const createBookingToDB = async (userId: string, payload: IBooking) => {
    const service = await Service.findById(payload.service);
    if (!service) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Service not found");
    }

    if (service.serviceType === 'unpaid') {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Booking is not allowed for unpaid services.");
    }

    payload.user = userId as any;
    payload.provider = service.provider;
    payload.totalAmount = service.price;
    payload.status = BOOKING_STATUS.REGISTERED;

    const bookingCountOnDate = await Booking.countDocuments({
        service: payload.service,
        date: payload.date,
    });

    if (bookingCountOnDate >= service.maxBookingsPerDay) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "Service is fully booked for this date",
        );
    }

    // Convert time to minutes for comparison
    const [startHour, startMin] = payload.startTime.split(':').map(Number);
    const [endHour, endMin] = payload.endTime.split(':').map(Number);

    const startTimeInMinutes = startHour * 60 + startMin;
    const endTimeInMinutes = endHour * 60 + endMin;

    // 1. Logical Range Check
    if (startTimeInMinutes >= endTimeInMinutes) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Start time must be before end time");
    }

    // 2. Duration Check
    // Helper function to parse duration string to minutes
    const parseDurationToMinutes = (durationStr: string): number => {
        const lowerDuration = durationStr.toLowerCase().trim();

        // Try parsing as simple number
        const simpleNumber = Number(lowerDuration);
        if (!isNaN(simpleNumber)) return simpleNumber;

        // Try parsing "X hour" or "X hr"
        const hourMatch = lowerDuration.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)$/);
        if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 60);

        // Try parsing "X min" or "X minutes"
        const minMatch = lowerDuration.match(/^(\d+)\s*(?:minutes?|mins?|m)$/);
        if (minMatch) return parseInt(minMatch[1], 10);

        // Try parsing "X hr Y min" format
        const combinedMatch = lowerDuration.match(/^(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(\d+)\s*(?:minutes?|mins?|m)$/);
        if (combinedMatch) {
            return Math.round(parseFloat(combinedMatch[1]) * 60) + parseInt(combinedMatch[2], 10);
        }

        return NaN;
    };

    const serviceDurationInMinutes = parseDurationToMinutes(service.duration);

    if (isNaN(serviceDurationInMinutes)) {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Invalid service duration format: ${service.duration}`
        );
    }

    const bookingDurationInMinutes = endTimeInMinutes - startTimeInMinutes;

    if (bookingDurationInMinutes !== serviceDurationInMinutes) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Booking duration (${bookingDurationInMinutes} mins) does not match service duration (${serviceDurationInMinutes} mins)`
        );
    }

    // 4. Business Hours Validation
    const provider = await User.findById(service.provider);
    if (!provider || !provider.business || !provider.business.businessHours) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Provider business hours not available");
    }

    const bookingDate = new Date(payload.date);
    const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

    // Check if the day exists in business hours (users might have different schemas, but assuming standard structure)
    // The interface has lowercased days: monday, tuesday, etc.
    const businessHours = provider.business.businessHours as any;
    const daySchedule = businessHours[dayOfWeek];

    if (!daySchedule) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Provider is not available on ${dayOfWeek}`);
    }

    const { from, to } = daySchedule;

    // Check if closed (e.g., 00:00 - 00:00 or similar convention, user request implied checking actual hours)
    if (from === to && from === '00:00') {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Provider is closed on ${dayOfWeek}`);
    }

    const [openHour, openMin] = from.split(':').map(Number);
    const [closeHour, closeMin] = to.split(':').map(Number);

    const openTimeInMinutes = openHour * 60 + openMin;
    const closeTimeInMinutes = closeHour * 60 + closeMin;

    if (startTimeInMinutes < openTimeInMinutes || endTimeInMinutes > closeTimeInMinutes) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Booking must be within business hours (${from} - ${to})`
        );
    }


    // 3. Overlap Check
    const existingBookings = await Booking.find({
        provider: service.provider,
        date: payload.date,
        status: { $ne: 'cancelled' },
    });

    for (const booking of existingBookings) {
        const [existingStartHour, existingStartMin] = booking.startTime.split(':').map(Number);
        const [existingEndHour, existingEndMin] = booking.endTime.split(':').map(Number);

        const existingStartInMinutes = existingStartHour * 60 + existingStartMin;
        const existingEndInMinutes = existingEndHour * 60 + existingEndMin;

        // Overlap condition: (StartA < EndB) and (EndA > StartB)
        if (startTimeInMinutes < existingEndInMinutes && endTimeInMinutes > existingStartInMinutes) {
            throw new ApiError(
                StatusCodes.BAD_REQUEST,
                `Time slot overlaps with an existing booking`
            );
        }
    }

    const result = await Booking.create(payload);

    if (service.serviceType === 'paid' && payload.paymentMethod === 'handCash') {
        await Booking.findByIdAndUpdate(result._id, {
            $set: {
                status: BOOKING_STATUS.PENDING,
                paymentStatus: PAYMENT_STATUS.FAILED,
            },
        });
    }

    // Increment booking count in service
    await Service.findByIdAndUpdate(payload.service, {
        $inc: { bookingCount: 1 },
    });

    // Send Notification to Provider
    const userEmail = await User.findById(userId).select('fullName');
    const userName = userEmail?.fullName || 'A customer';

    await NotificationService.insertNotification({
        receiver: service.provider,
        title: "New Booking",
        message: `You have received a new booking from ${userName}`,
        type: USER_ROLES.BUSINESS,
        referenceId: result._id as any,
    });

    return result;
};

const getAllBookingsFromDB = async (user: any, query: Record<string, unknown>) => {
    let primaryFilter: Record<string, unknown> = {};

    if (user.role === 'client') {
        primaryFilter = { user: user.authId };
    } else if (user.role === 'business') {
        primaryFilter = { provider: user.authId };
    } else if (user.role === 'admin') {
        primaryFilter = {};
    }

    const bookingQuery = new QueryBuilder(
        Booking.find(primaryFilter).populate([
            { path: 'service', select: 'name price photos duration' },
            { path: 'provider', select: 'fullName email image business.businessName business.logo' },
            { path: 'user', select: 'fullName email image' }
        ]),
        query
    )
        .filter()
        .sort()
        .paginate()
        .fields();

    const result = await bookingQuery.modelQuery;
    const meta = await bookingQuery.getPaginationInfo();

    return {
        meta,
        result,
    };
};

const getSingelBookingFromDB = async (id: string) => {
    const booking = await Booking.findById(id).populate([
        { path: 'service', select: 'name price photos duration description' },
        { path: 'provider', select: 'fullName email image phone business.businessName business.logo business.address business.city' },
        { path: 'user', select: 'fullName email image phone' }
    ]);
    if (!booking) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Booking not found");
    }
    return booking;
};

const updateBookingStatusInDB = async (id: string, user: any, status: string) => {
    const booking = await Booking.findById(id);
    if (!booking) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Booking not found");
    }

    // Role-based authorization and status restriction
    if (user.role === 'client') {
        if (booking.user.toString() !== user.authId) {
            throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to update this booking");
        }

        if (status === BOOKING_STATUS.CANCELLED) {
            // Client can only cancel if status is PENDING
            if (booking.status !== BOOKING_STATUS.PENDING) {
                throw new ApiError(StatusCodes.BAD_REQUEST, "Clients can only cancel bookings in pending status");
            }
        } else if (status === BOOKING_STATUS.COMPLETED) {
            // Client can only complete if status is CONFIRMED (Accepted)
            if (booking.status !== BOOKING_STATUS.CONFIRMED) {
                throw new ApiError(StatusCodes.BAD_REQUEST, "Booking must be accepted (confirmed) before it can be completed");
            }
        } else {
            throw new ApiError(StatusCodes.FORBIDDEN, "Clients can only cancel or complete their own bookings");
        }
    } else if (user.role === 'business') {
        if (booking.provider.toString() !== user.authId) {
            throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to update this booking");
        }

        if (status === BOOKING_STATUS.CANCELLED) {
            // Business can only cancel if status is PENDING
            if (booking.status !== BOOKING_STATUS.PENDING) {
                throw new ApiError(StatusCodes.BAD_REQUEST, "Business can only cancel bookings in pending status");
            }
        } else if (status === BOOKING_STATUS.CONFIRMED) {
            // Business can accept a booking (Pending -> Confirmed)
            if (booking.status !== BOOKING_STATUS.PENDING) {
                throw new ApiError(StatusCodes.BAD_REQUEST, "Only pending bookings can be accepted");
            }
        } else if (status === BOOKING_STATUS.COMPLETED) {
            throw new ApiError(StatusCodes.FORBIDDEN, "Business side cannot mark a booking as completed. Only clients or admins can do this.");
        }
    } else if (user.role === 'admin') {
        if (status === BOOKING_STATUS.CANCELLED) {
            // Admin can cancel if status is PENDING or CONFIRMED
            if (booking.status !== BOOKING_STATUS.PENDING && booking.status !== BOOKING_STATUS.CONFIRMED) {
                throw new ApiError(StatusCodes.BAD_REQUEST, "Admin can only cancel pending or accepted bookings");
            }
        }
    } else {
        throw new ApiError(StatusCodes.FORBIDDEN, "Unauthorized role");
    }

    const result = await Booking.findByIdAndUpdate(
        id,
        { status },
        { new: true, runValidators: true }
    );

    // If status is completed and online payment was paid, trigger transfer
    if (
        status === BOOKING_STATUS.COMPLETED &&
        result?.paymentMethod === "online" &&
        result?.paymentStatus === PAYMENT_STATUS.PAID &&
        !result.isTransferred
    ) {
        const provider = await User.findById(result.provider);

        if (provider?.business?.stripeAccountId && provider?.business?.stripeOnboardingCompleted) {
            try {
                // Calculate payout: 
                // Calculate payout: 
                // totalAmount is in GBP (gross). stripeFeeAmount is in cents.
                const totalInCents = result.totalAmount * 100;
                let stripeFee = result.stripeFeeAmount || 0;

                // If fee is 0 and we have a transaction ID, try to fetch it from Stripe
                if (stripeFee === 0 && result.transactionId) {
                    try {
                        const charge = await stripe.charges.retrieve(result.transactionId, {
                            expand: ['balance_transaction']
                        }).catch(async () => {
                            // Fallback: if transactionId is a PI, retrieve it
                            const pi = await stripe.paymentIntents.retrieve(result.transactionId!);
                            if (pi.latest_charge) {
                                const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge.id;
                                return await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
                            }
                            return null;
                        });

                        if (charge?.balance_transaction) {
                            const bt = charge.balance_transaction as Stripe.BalanceTransaction;
                            stripeFee = bt.fee;
                            // Optionally update the booking with the found fee
                            await Booking.findByIdAndUpdate(id, { stripeFeeAmount: stripeFee });
                        }
                    } catch (err) {
                        logger.error(`Failed to fetch Stripe fee for booking ${id}:`, err);
                    }
                }

                // Payout = Gross - Fee (0% platform fee)
                const netPayoutInCents = totalInCents - stripeFee;
                const payoutAmount = netPayoutInCents / 100;

                if (payoutAmount > 0) {
                    await initiateStripeTransfer(
                        payoutAmount,
                        provider.business.stripeAccountId,
                        id
                    );

                    await Booking.findByIdAndUpdate(id, {
                        $set: { isTransferred: true }
                    });
                }
            } catch (error) {
                logger.error(`Failed to transfer funds for booking ${id}:`, error);
            }
        }
    }



    // --- NOTIFICATIONS ---
    try {
        if (result) {
            const customer = await User.findById(result.user).select('fullName');
            const provider = await User.findById(result.provider).select('fullName');
            const service = await Service.findById(result.service).select('name');

            const customerName = customer?.fullName || 'Customer';
            const providerName = provider?.fullName || 'Provider';
            const serviceName = service?.name || 'Service';

            if (status === BOOKING_STATUS.CONFIRMED) {
                // Notify Customer
                await NotificationService.insertNotification({
                    receiver: result.user,
                    title: "Booking Accepted",
                    message: `Your booking for ${serviceName} has been accepted by ${providerName}.`,
                    type: "client",
                    referenceId: result._id as any,
                });
            } else if (status === BOOKING_STATUS.CANCELLED) {
                // If user who updated is customer, notify provider
                if (user.role === 'client') {
                    await NotificationService.insertNotification({
                        receiver: result.provider,
                        title: "Booking Cancelled",
                        message: `The booking for ${serviceName} has been cancelled by ${customerName}.`,
                        type: "business",
                        referenceId: result._id as any,
                    });
                } else {
                    // Notify Customer
                    await NotificationService.insertNotification({
                        receiver: result.user,
                        title: "Booking Cancelled",
                        message: `Your booking for ${serviceName} has been cancelled by ${providerName}.`,
                        type: "client",
                        referenceId: result._id as any,
                    });
                }
            } else if (status === BOOKING_STATUS.COMPLETED) {
                // Notify Provider
                await NotificationService.insertNotification({
                    receiver: result.provider,
                    title: "Booking Completed",
                    message: `The booking for ${serviceName} with ${customerName} is now marked as completed.`,
                    type: "business",
                    referenceId: result._id as any,
                });

                // Notify Customer
                await NotificationService.insertNotification({
                    receiver: result.user,
                    title: "Booking Completed",
                    message: `Your booking for ${serviceName} is completed. Please leave a review!`,
                    type: "client",
                    referenceId: result._id as any,
                });
            }
        }
    } catch (err) {
        logger.error(`Failed to send status update notification for booking ${id}:`, err);
    }

    return result;
};

const deleteBookingFromDB = async (id: string) => {
    const isBookingExist = await Booking.findById(id);
    if (!isBookingExist) {
        throw new ApiError(StatusCodes.NOT_FOUND, "Booking not found");
    }
    const result = await Booking.findByIdAndDelete(id);
    return result;
};

export const BookingService = {
    createBookingToDB,
    getAllBookingsFromDB,
    getSingelBookingFromDB,
    updateBookingStatusInDB,
    deleteBookingFromDB,
};
