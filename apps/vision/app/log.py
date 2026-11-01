"""Structured log setup for the vision service."""

from __future__ import annotations

import logging

from .config import Config


def setup_logging(cfg: Config) -> logging.Logger:
    logger = logging.getLogger("smart-speed-vision")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        logger.addHandler(handler)
    logger.setLevel(cfg.log_level)
    logger.propagate = False
    return logger