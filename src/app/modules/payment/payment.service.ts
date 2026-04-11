import QueryBuilder from "../../builder/QueryBuilder";
import { IPayment } from "./payment.interface";
import { Payment } from "./payment.model";
import { createPaymentSession } from "../../../stripe/createPaymentSession";
import { JwtPayload } from "jsonwebtoken";
import { Booking } from "../booking/booking.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiError";
import { USER_ROLES } from "../user/user.interface";

// Create seassion
const creatSession = async (user: JwtPayload, bookingId: string) => {



    const booking = await Booking.findById(bookingId).populate('service');
    if (!booking) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Booking not found");
    }

    if((booking.service as any).serviceType === 'unpaid'){
        throw new ApiError(StatusCodes.BAD_REQUEST, "Payment is not required for unpaid services");
    }

    const finalAmount = booking.totalAmount;


    const url = await createPaymentSession(user, finalAmount, bookingId);

    return { url }
}

// create payment
const createPayment = async (payload: Partial<IPayment>) => {
  const payment = await Payment.create(payload);
  return payment;
};

// get payments
const getPayments = async (user: JwtPayload, query: Record<string, unknown>) => {
  const primaryFilter: Record<string, unknown> = {}
  if (user.role === USER_ROLES.CLIENT) {
    primaryFilter.email = user.email;
  }

  const paymentQueryBuilder = new QueryBuilder(Payment.find(primaryFilter), query)
    .filter()
    .sort()
    .paginate();

  const payments = await paymentQueryBuilder.modelQuery;
  const paginationInfo = await paymentQueryBuilder.getPaginationInfo();

  return {
    data: payments,
    meta: paginationInfo,
  };
};

// get payment by id
const getPaymentById = async (id: string) => {
  return await Payment.findById(id).populate('referenceId');
};

export const PaymentService = {
  creatSession,
  createPayment,
  getPayments,
  getPaymentById,
}
