import * as DialogPrimitive from '@radix-ui/react-dialog';
import type {ComponentPropsWithoutRef, ElementRef, HTMLAttributes} from 'react';
import {forwardRef} from 'react';

import {cn} from '../../lib/utils.js';

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({className, ...props}, ref) {
  return <DialogPrimitive.Overlay ref={ref} className={cn('shad-dialog-overlay', className)} {...props} />;
});

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(function DialogContent({className, children, ...props}, ref) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} className={cn('shad-dialog-content', className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

function DialogHeader({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shad-dialog-header', className)} {...props} />;
}

function DialogFooter({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shad-dialog-footer', className)} {...props} />;
}

const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({className, ...props}, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn('shad-dialog-title', className)} {...props} />;
});

const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({className, ...props}, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('shad-dialog-description', className)} {...props} />;
});

export {Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle};
