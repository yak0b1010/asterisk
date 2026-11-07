"""Host metrics shown on the dashboard."""

from fastapi import APIRouter, Depends

from .. import system_metrics
from ..deps import get_current_user
from ..models import User
from ..schemas import SystemMetrics

router = APIRouter(tags=["system"])


@router.get("/system/metrics", response_model=SystemMetrics)
def metrics(_user: User = Depends(get_current_user)) -> dict:
    return system_metrics.collect()
