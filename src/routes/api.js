import express from 'express';
import { environments, getAlerts, getEndpoints, getLogs, getOverview, getRca, getServices, getTraces, workspaces } from '../data/mockStore.js';

const router = express.Router();

function validateEnvironment(req, res, next) {
  const env = req.params.environment || req.query.environment;
  if (env && !environments.includes(env)) {
    return res.status(400).json({ error: 'Invalid environment', allowed: environments });
  }
  next();
}

router.get('/workspaces', (_req, res) => res.json({ workspaces }));
router.get('/environments', (_req, res) => res.json({ environments }));

router.get('/:workspaceId/:environment/overview', validateEnvironment, (req, res) => {
  res.json(getOverview(req.params.workspaceId, req.params.environment));
});

router.get('/:workspaceId/:environment/services', validateEnvironment, (req, res) => {
  res.json({ services: getServices(req.params.workspaceId, req.params.environment) });
});

router.get('/:workspaceId/:environment/endpoints', validateEnvironment, (req, res) => {
  res.json({ endpoints: getEndpoints(req.params.workspaceId, req.params.environment, req.query.serviceId) });
});

router.get('/:workspaceId/:environment/traces', validateEnvironment, (req, res) => {
  res.json({ traces: getTraces(req.params.workspaceId, req.params.environment) });
});

router.get('/:workspaceId/:environment/logs', validateEnvironment, (req, res) => {
  res.json({ logs: getLogs(req.params.workspaceId, req.params.environment) });
});

router.get('/:workspaceId/:environment/alerts', validateEnvironment, (req, res) => {
  res.json({ alerts: getAlerts(req.params.workspaceId, req.params.environment) });
});

router.get('/:workspaceId/:environment/rca', validateEnvironment, (req, res) => {
  res.json(getRca(req.params.workspaceId, req.params.environment));
});

export default router;
