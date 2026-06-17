const express = require('express');
const {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
} = require('../controllers/planController');
const {
  createPlanSchema,
  updatePlanSchema,
  getPlansSchema,
  getPlanByIdSchema,
  validate,
  validateQuery,
  validateParams,
} = require('../validations/planValidation');
const { authenticate, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/', validateQuery(getPlansSchema), getPlans);
router.get('/:id', validateParams(getPlanByIdSchema), getPlanById);
router.post('/', authenticate, requireAdmin, validate(createPlanSchema), createPlan);
router.put('/:id', authenticate, requireAdmin, validateParams(getPlanByIdSchema), validate(updatePlanSchema), updatePlan);
router.delete('/:id', authenticate, requireAdmin, validateParams(getPlanByIdSchema), deletePlan);

module.exports = router;
