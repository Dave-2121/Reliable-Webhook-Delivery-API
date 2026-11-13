import { Router } from 'express';
import { validateEndpointInput } from '../validators.js';
import { createEndpoint } from '../services/endpointService.js';

export function createEndpointRoutes({ pool }) {
  const router = Router();

  // POST /webhook-endpoints
  router.post('/', async (req, res) => {
    const data = validateEndpointInput(req.body); // throws ValidationError -> 400
    const endpoint = await createEndpoint(pool, data);
    res.status(201).json(endpoint);
  });

  return router;
}
