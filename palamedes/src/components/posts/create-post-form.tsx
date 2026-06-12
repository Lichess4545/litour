"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTRPC } from "@/trpc/react";

const createPostSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  content: z.string().min(1, "Content is required").max(10_000),
});

function FieldErrors({
  errors,
}: {
  errors: ReadonlyArray<{ message: string } | undefined>;
}) {
  const messages = errors.flatMap((error) =>
    error === undefined ? [] : [error.message],
  );
  if (messages.length === 0) {
    return null;
  }
  return <p className="text-destructive text-sm">{messages.join(", ")}</p>;
}

export function CreatePostForm() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createPost = useMutation(
    trpc.post.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.post.list.queryFilter());
        toast.success("Post created");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const form = useForm({
    defaultValues: { title: "", content: "" },
    validators: { onSubmit: createPostSchema },
    onSubmit: async ({ value, formApi }) => {
      await createPost.mutateAsync(value);
      formApi.reset();
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="title">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={field.name}>Title</Label>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="content">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor={field.name}>Content</Label>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <Button
        type="submit"
        disabled={createPost.isPending}
        className="self-start"
      >
        {createPost.isPending ? "Creating…" : "Create post"}
      </Button>
    </form>
  );
}
