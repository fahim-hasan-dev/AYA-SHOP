import express from "express";
import { ServiceController } from "./service.controller";
import auth from "../../middleware/auth";
import { USER_ROLES } from "../user/user.interface";
import validateRequest from "../../middleware/validateRequest";
import { ServiceValidation } from "./service.validation";
import { fileAndBodyProcessorUsingDiskStorage } from "../../middleware/processReqBody";
import { businessAuth } from "../../middleware/businessAuth";

const router = express.Router();

router.post(
    "/",
    auth(USER_ROLES.BUSINESS),
    businessAuth,
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(ServiceValidation.createServiceSchema),
    ServiceController.createService
);

router.get("/",
    ServiceController.getAllServices
);

router.get("/my-services",
    auth(USER_ROLES.BUSINESS),
    businessAuth,
    ServiceController.getMyServices
);

router.get("/admin/all-services",
    auth(USER_ROLES.ADMIN),
    ServiceController.getAdminServices
);

router.get("/top-rated",
    ServiceController.getTopRatedServices
);

router.get("/:id",
    auth(USER_ROLES.BUSINESS, USER_ROLES.ADMIN, USER_ROLES.CLIENT),
    ServiceController.getSingleService
);

router.get("/:id/availability",
    auth(USER_ROLES.BUSINESS, USER_ROLES.ADMIN, USER_ROLES.CLIENT),
    ServiceController.getAvailableSlots
);

router.patch(
    "/:id",
    auth(USER_ROLES.BUSINESS),
    businessAuth,
    fileAndBodyProcessorUsingDiskStorage(),
    validateRequest(ServiceValidation.updateServiceSchema),
    ServiceController.updateService
);

router.patch(
    "/:id/toggle-status",
    auth(USER_ROLES.BUSINESS, USER_ROLES.ADMIN),
    ServiceController.toggleServiceStatus
);

router.delete("/:id",
    auth(USER_ROLES.BUSINESS, USER_ROLES.ADMIN),
    businessAuth,
    ServiceController.deleteService
);

export const ServiceRoutes = router;
