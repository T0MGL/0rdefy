import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = schema.safeParse(req[target]);
        if (!result.success) {
            res.status(400).json({
                error: 'Validation failed',
                issues: result.error.issues.map((i) => ({
                    path: i.path.join('.'),
                    message: i.message,
                })),
            });
            return;
        }
        req[target] = result.data as typeof req[typeof target];
        next();
    };
}

export function formatZodError(error: ZodError): { path: string; message: string }[] {
    return error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
    }));
}
