import {Toaster} from 'react-hot-toast';

export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        className: 'app-toast',
        duration: 6000,
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
