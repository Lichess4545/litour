import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";

export const postCreateInput = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required").max(10_000),
});

export const postRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.post.findMany({
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true } } },
    }),
  ),

  byId: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const post = await ctx.db.post.findUnique({
        where: { id: input.id },
        include: { author: { select: { id: true, name: true } } },
      });
      if (post === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Post ${input.id} not found`,
        });
      }
      return post;
    }),

  create: protectedProcedure.input(postCreateInput).mutation(({ ctx, input }) =>
    ctx.db.post.create({
      data: { ...input, authorId: ctx.session.user.id },
      include: { author: { select: { id: true, name: true } } },
    }),
  ),
});
