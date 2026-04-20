import {Toaster} from 'react-hot-toast';

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: 'app-toast',
        duration: 6000,
        // react-hot-toast hardcodes background:#fff;color:#363636 as inline
        // styles on the toast body, which would beat our class-based palette.
        // Route them through the same CSS vars so the toast follows the theme.
        style: {
          background: 'var(--panel-strong)',
          color: 'var(--text)',
        },
        error: {
          className: 'app-toast app-toast-error',
        },
        success: {
          className: 'app-toast app-toast-success',
        },
      }}
    />
  );
}
