import { Prisma } from '@prisma/client';

/** Repete somente transações abortadas pelo banco, nunca erros de rede/resultado incerto. */
export async function retryTransaction<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
        (error instanceof Prisma.PrismaClientUnknownRequestError &&
          /\b40P01\b/.test(error.message));
      if (!retryable || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
