variable "VERSION" {
  default = "DEV"
}

target "common" {
  context   = "."
  platforms = ["linux/amd64", "linux/arm64"]
}

group "default" {
  targets = ["base", "uvx", "deno"]
}

target "base" {
  inherits   = ["common"]
  dockerfile = "docker/base.Dockerfile"
  tags = [
    "ghcr.io/bencouture/supergateway:latest",
    "ghcr.io/bencouture/supergateway:base",
    "ghcr.io/bencouture/supergateway:${VERSION}"
  ]
}

target "uvx" {
  inherits   = ["common"]
  depends_on  = ["base"]
  dockerfile = "docker/uvx.Dockerfile"
  contexts = { base = "target:base" }
  tags = [
    "ghcr.io/bencouture/supergateway:uvx",
    "ghcr.io/bencouture/supergateway:${VERSION}-uvx"
  ]
}

target "deno" {
  inherits   = ["common"]
  depends_on  = ["base"]
  dockerfile = "docker/deno.Dockerfile"
  contexts = { base = "target:base" }
  tags = [
    "ghcr.io/bencouture/supergateway:deno",
    "ghcr.io/bencouture/supergateway:${VERSION}-deno"
  ]
}
