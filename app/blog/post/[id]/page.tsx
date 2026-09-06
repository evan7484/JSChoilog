import { cache } from "react";
import { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import BlogPost from "@/components/BlogPost";
import JsonLd from "@/components/JsonLd";
import {
  getBlogPostMeta,
  getBlogPostMetaBySlug,
  getBlogPosts,
  getPageContent,
} from "@/lib/notion/blog";
import type { BlogPost as BlogPostType } from "@/lib/notion/types";
import { SITE_URL, UUID_RE, postPath } from "@/lib/site";
import { postDescription } from "@/lib/text";

// Notion 커버 이미지 URL 만료(약 1시간)보다 짧게
export const revalidate = 1800;

// 공개 글을 빌드 타임에 프리렌더 — 이게 없으면 [id] 라우트는 ISR 캐시 없이
// 매 요청 풀 SSR이 되어 Notion 페치 비용(1.5~2.5초)을 방문자마다 지불한다
export async function generateStaticParams() {
  const posts = await getBlogPosts();
  return posts.map((post) => ({ id: post.slug || post.id }));
}

// URL 파라미터는 UUID(구 URL) 또는 슬러그 — generateMetadata와 렌더링이 공유.
// 본문은 따로 페치한다: UUID → 슬러그 301 대상이면 본문이 버려지므로
const resolvePost = cache(async (param: string) =>
  UUID_RE.test(param) ? getBlogPostMeta(param) : getBlogPostMetaBySlug(param)
);
const resolveContent = cache(async (post: BlogPostType) =>
  getPageContent(post.id, post.excerpt)
);
const getPosts = cache(getBlogPosts);

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const post = await resolvePost(id);

  if (!post) {
    return { title: "Post Not Found" };
  }

  // 301 리다이렉트될 구 UUID URL — 본문 페치 없이 최소 메타만
  if (UUID_RE.test(id) && post.slug) {
    return { title: post.title };
  }

  const description = postDescription({
    ...post,
    content: await resolveContent(post),
  });

  return {
    title: post.title,
    description,
    alternates: { canonical: postPath(post) },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      publishedTime: post.date,
      tags: post.tags,
      ...(post.cover && { images: [{ url: post.cover }] }),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      ...(post.cover && { images: [post.cover] }),
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { id } = await params;
  const meta = await resolvePost(id);

  if (!meta) {
    notFound();
  }

  // 슬러그가 생긴 글의 구 UUID URL은 301로 슬러그 URL에 정착 (기존 색인 보존)
  // — 본문 페치 전에 처리해 리다이렉트에 버려질 비용을 만들지 않는다
  if (UUID_RE.test(id) && meta.slug) {
    permanentRedirect(postPath(meta));
  }

  // 본문 변환과 이전/다음용 목록 조회는 서로 독립 — 병렬로
  const [content, posts] = await Promise.all([
    resolveContent(meta),
    getPosts(),
  ]);
  const post = { ...meta, content };

  const idx = posts.findIndex((p) => p.id === post.id);
  const newerPost = idx > 0 ? posts[idx - 1] : null;
  const olderPost = idx >= 0 && idx < posts.length - 1 ? posts[idx + 1] : null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: postDescription(post),
          datePublished: post.date,
          author: {
            "@type": "Person",
            name: "최준서",
            url: `${SITE_URL}/about`,
          },
          mainEntityOfPage: `${SITE_URL}${postPath(post)}`,
          ...(post.cover && { image: post.cover }),
          keywords: post.tags.join(", "),
          articleSection: post.category,
          inLanguage: "ko",
        }}
      />
      <BlogPost post={post} newerPost={newerPost} olderPost={olderPost} />
    </>
  );
}
