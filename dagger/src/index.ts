import { dag, Container, Directory, object, func } from "@dagger.io/dagger";

@object()
class Swirly {
  source: Directory;

  constructor(source: Directory) {
    this.source = source;
  }

  @func()
  build(): Directory {
    return this.source.diff(
      dag
        .apko()
        .wolfi(["nodejs", "yarn", "bash"])
        .withEnvVariable("PATH", "/usr/local/bin:${PATH}", { expand: true })
        .withExec(["yarn", "global", "add", "jsx"])
        .withMountedDirectory("/mnt", this.source)
        .withWorkdir("/mnt")
        .withExec(["./build.sh"])
        .directory("."),
    );
  }
}
