"""numpy and nibabel when they are not installed: the viewer-only build.

The standard install bundles both. The minimal build leaves them out and the
`python-numpy` module brings them, so the server must start without them: the
few modules that import them at the top do

    try:
        import numpy as np
    except ImportError:
        from core_packages import np

and get a stand-in that imports the real package on first use. Nothing slows
down where numpy is present (the stand-in is never used there); where it isn't,
first use raises MissingCorePackage, which server.py answers with a 503 naming
the module to install. Installed while MRLatte runs, the module is picked up on
the next use: the stand-in tries the import again each time until it works.
"""
import importlib

# Package -> the module that brings it, for the 503 that names what to install.
PROVIDED_BY = {"numpy": "python-numpy", "nibabel": "python-numpy",
               "scipy": "python-scipy", "lqtpy": "lqtpy"}


class MissingCorePackage(ModuleNotFoundError):
    """A package from PROVIDED_BY is not installed."""

    def __init__(self, package):
        self.package, self.module_id = package, PROVIDED_BY.get(package)
        super().__init__(f"{package} is not installed (the {self.module_id} module)", name=package)


class _StandIn:
    def __init__(self, package):
        self._package = package
        self._real = None

    def __getattr__(self, attr):
        if self._real is None:
            try:
                self._real = importlib.import_module(self._package)
            except ImportError:
                raise MissingCorePackage(self._package) from None
        return getattr(self._real, attr)

    def __repr__(self):
        return f"<stand-in for {self._package}: {'imported' if self._real else 'not installed'}>"


np = _StandIn("numpy")
nib = _StandIn("nibabel")


def missing_package(exc):
    """The PROVIDED_BY package an ImportError is about, or None."""
    name = (getattr(exc, "name", None) or "").split(".")[0]
    return name if name in PROVIDED_BY else None
