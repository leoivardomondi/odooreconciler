import { Router } from 'express';
import accessControlRoutes from './accessControl';
import authRoutes from './auth';
import dashboardRoutes from './dashboard';
import extractionRoutes from './extractions';
import installRoutes from './install';
import invoiceParserRoutes from './invoiceParser';
import jobsRoutes from './jobs';
import notificationsRoutes from './notifications';
import mpesaReconciliationRoutes from './mpesaReconciliation';
import poBillAutomationRoutes from './poBillAutomation';
import purchaseOrderRoutes from './purchaseOrders';
import salesOrderRoutes from './salesOrders';
import settingsRoutes from './settings';
import setupRoutes from './setup';
import shopFloorRoutes from './shopFloor';
import staffOnboardingRoutes from './staffOnboarding';

const router = Router();

router.get('/', (req, res) => {
  const user = req.viewingAsUser || req.authUser;
  res.redirect(user && user.role !== 'admin' && user.apps?.includes('shop-floor') ? '/shop-floor' : '/dashboard');
});

router.use('/', authRoutes);
router.use('/', installRoutes);
router.use('/', setupRoutes);
router.use('/', dashboardRoutes);
router.use('/', invoiceParserRoutes);
router.use('/', salesOrderRoutes);
router.use('/', purchaseOrderRoutes);
router.use('/', poBillAutomationRoutes);
router.use('/', notificationsRoutes);
router.use('/', mpesaReconciliationRoutes);
router.use('/', extractionRoutes);
router.use('/', jobsRoutes);
router.use('/', accessControlRoutes);
router.use('/', settingsRoutes);
router.use('/', shopFloorRoutes);
router.use('/', staffOnboardingRoutes);

export default router;
